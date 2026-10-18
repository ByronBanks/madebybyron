<?php
/*
  Site editor server: password sign-in, password reset and publishing to GitHub.

  The GitHub token lives only here on the server, in config.php, which the deploy
  writes from GitHub secrets (CMS_GITHUB_TOKEN, ADMIN_EMAIL). Browsers never see it.

  Passwords are stored as one-way hashes in data/, which is created on first use
  and never deployed or served.

  Actions (?action=…): session, login, logout, requestReset, reset, changePassword,
  content, publish.
*/
declare(strict_types=1);
// Warnings must never end up in the JSON the editor reads (they go to the server log instead)
ini_set('display_errors', '0');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

$cfg = is_file(__DIR__ . '/config.php') ? (require __DIR__ . '/config.php') : [];
if (!is_array($cfg)) $cfg = [];
$DATA = __DIR__ . '/data';

const SESSION_DAYS = 30;
const MIN_PASSWORD = 10;
const COOKIE = 'mbbcms';

/* ---------- Helpers ---------- */
function out(array $data, int $code = 200): void { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_SLASHES); exit; }
function fail(string $msg, int $code = 400): void { out(['error' => $msg], $code); }
function input(): array {
  $raw = file_get_contents('php://input');
  $data = json_decode($raw ?: '[]', true);
  return is_array($data) ? $data : [];
}
function client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? 'unknown'; }
function configured(): bool { global $cfg; return !empty($cfg['github_token']) && !empty($cfg['repo']); }

// Small JSON stores kept as .php files that refuse to be served
function store_file(string $name): string { global $DATA; return $DATA . '/' . $name . '.php'; }
function load(string $name, $default) {
  $f = store_file($name);
  if (!is_file($f)) return $default;
  $raw = (string) file_get_contents($f);
  $pos = strpos($raw, "\n");
  $value = json_decode($pos === false ? '' : substr($raw, $pos + 1), true);
  return $value === null ? $default : $value;
}
function save(string $name, $value): void {
  global $DATA;
  if (!is_dir($DATA)) {
    mkdir($DATA, 0700, true);
    file_put_contents($DATA . '/index.html', '');
    file_put_contents($DATA . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
  }
  $tmp = store_file($name) . '.' . bin2hex(random_bytes(4)) . '.tmp';
  file_put_contents($tmp, "<?php http_response_code(404); exit; ?>\n" . json_encode($value), LOCK_EX);
  rename($tmp, store_file($name));
}

/* ---------- Sessions: random token in an HttpOnly cookie, hash kept on the server ---------- */
function cookie_path(): string {
  $dir = rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/api/cms.php'))), '/');
  return $dir . '/';
}
function set_session_cookie(string $value, int $maxAge): void {
  $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
  setcookie(COOKIE, $value, [
    'expires' => $maxAge > 0 ? time() + $maxAge : time() - 3600,
    'path' => cookie_path(),
    'secure' => $secure,
    'httponly' => true,
    'samesite' => 'Strict',
  ]);
}
function start_session(): void {
  $token = bin2hex(random_bytes(32));
  $sessions = array_filter(load('sessions', []), function ($exp) { return $exp > time(); });
  $sessions[hash('sha256', $token)] = time() + SESSION_DAYS * 86400;
  save('sessions', $sessions);
  set_session_cookie($token, SESSION_DAYS * 86400);
}
function signed_in(): bool {
  $token = $_COOKIE[COOKIE] ?? '';
  if (!is_string($token) || strlen($token) !== 64) return false;
  $sessions = load('sessions', []);
  $key = hash('sha256', $token);
  if (empty($sessions[$key]) || $sessions[$key] < time()) return false;
  return true;
}
function end_all_sessions(): void { save('sessions', []); }
function require_signed_in(): void { if (!signed_in()) fail('Please sign in again.', 401); }

/* ---------- Rate limits (wrong passwords, reset emails) ---------- */
function too_many(string $bucket, int $max, int $window): bool {
  $all = load('limits', []);
  $now = time();
  $key = $bucket . ':' . client_ip();
  $hits = array_values(array_filter($all[$key] ?? [], function ($t) use ($now, $window) { return $t > $now - $window; }));
  $global = array_values(array_filter($all[$bucket . ':*'] ?? [], function ($t) use ($now, $window) { return $t > $now - $window; }));
  return count($hits) >= $max || count($global) >= $max * 5;
}
function note_hit(string $bucket, int $window): void {
  $all = load('limits', []);
  $now = time();
  foreach ([$bucket . ':' . client_ip(), $bucket . ':*'] as $key) {
    $hits = array_values(array_filter($all[$key] ?? [], function ($t) use ($now, $window) { return $t > $now - $window; }));
    $hits[] = $now;
    $all[$key] = $hits;
  }
  save('limits', $all);
}

/* ---------- Passwords ---------- */
function has_password(): bool { $a = load('auth', []); return !empty($a['hash']); }
function set_password(string $password): void {
  if (strlen($password) < MIN_PASSWORD) fail('Use at least ' . MIN_PASSWORD . ' characters.');
  save('auth', ['hash' => password_hash($password, PASSWORD_DEFAULT), 'changed' => time()]);
  end_all_sessions();  // sign out every other device
  save('reset', []);   // any pending reset link stops working
  start_session();
}

/* ---------- GitHub ---------- */
function gh(string $method, string $path, $body = null, bool $raw = false, ?string $token = null) {
  global $cfg;
  $base = $cfg['github_api'] ?? 'https://api.github.com';
  $ch = curl_init($base . '/repos/' . $cfg['repo'] . $path);
  $headers = [
    'Authorization: Bearer ' . ($token ?? $cfg['github_token']),
    'Accept: ' . ($raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json'),
    'X-GitHub-Api-Version: 2022-11-28',
    'User-Agent: made-by-byron-site-editor',
  ];
  if ($body !== null) $headers[] = 'Content-Type: application/json';
  curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 60,
  ]);
  if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
  $res = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $err = curl_error($ch);
  if ($res === false) fail('Could not reach GitHub: ' . $err, 502);
  if ($status >= 400) {
    $msg = json_decode((string) $res, true)['message'] ?? ('GitHub error ' . $status);
    return ['__error' => $msg, '__status' => $status];
  }
  return $raw ? $res : json_decode((string) $res, true);
}
function gh_ok($r, string $what) {
  if (is_array($r) && isset($r['__error'])) {
    $msg = $r['__status'] === 401 ? 'The GitHub token on the server has expired or been revoked. Create a new one and update the CMS_GITHUB_TOKEN secret.' : $r['__error'];
    fail("$what: $msg", $r['__status'] === 422 ? 409 : 502);
  }
  return $r;
}

// Turn embedded images into files in images/uploads/.
// Content is kept as objects (not arrays) so {} stays {} when it's written back.
function extract_images(&$node, array &$files): void {
  if (is_array($node)) { foreach (array_keys($node) as $k) extract_images($node[$k], $files); return; }
  if (is_object($node)) { foreach (array_keys(get_object_vars($node)) as $k) extract_images($node->$k, $files); return; }
  if (!is_string($node) || strpos($node, 'data:image/') !== 0) return;
  $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp', 'image/svg+xml' => 'svg'];
  if (!preg_match('#^data:(image/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$#', $node, $m) || !isset($ext[$m[1]])) fail('Unsupported image type — use JPG, PNG, GIF, WebP or SVG.');
  $bytes = base64_decode($m[2], true);
  if ($bytes === false) fail('An image could not be read.');
  $path = 'images/uploads/' . substr(hash('sha256', $bytes), 0, 16) . '.' . $ext[$m[1]];
  $files[$path] = $m[2];
  $node = $path;
}

/* ---------- Requests ---------- */
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Writes must come from the editor itself (custom header → no cross-site forms)
if ($method === 'POST' && ($_SERVER['HTTP_X_CMS'] ?? '') !== '1') fail('Bad request.', 403);

switch ($action) {
  case 'session':
    $email = (string) ($cfg['admin_email'] ?? '');
    $masked = $email ? preg_replace('/(?<=.).(?=[^@]*?.@)/', '•', $email) : null;
    out(['configured' => configured(), 'hasPassword' => has_password(), 'signedIn' => configured() && signed_in(),
         'email' => $masked, 'repo' => $cfg['repo'] ?? null]);

  case 'login':
    if ($method !== 'POST') fail('Use POST.', 405);
    if (!configured()) fail('The editor server is not set up yet.', 503);
    if (!has_password()) fail('No password has been set yet. Choose “Set up a password”.', 409);
    if (too_many('login', 8, 900)) fail('Too many wrong attempts. Try again in 15 minutes, or reset your password.', 429);
    $pw = (string) (input()['password'] ?? '');
    $auth = load('auth', []);
    if (!password_verify($pw, $auth['hash'] ?? '')) {
      note_hit('login', 900);
      usleep(400000);
      fail('That password is not right.', 401);
    }
    if (password_needs_rehash($auth['hash'], PASSWORD_DEFAULT)) save('auth', ['hash' => password_hash($pw, PASSWORD_DEFAULT), 'changed' => time()]);
    start_session();
    out(['ok' => true]);

  case 'logout':
    if ($method !== 'POST') fail('Use POST.', 405);
    $token = $_COOKIE[COOKIE] ?? '';
    if (is_string($token) && $token !== '') {
      $sessions = load('sessions', []);
      unset($sessions[hash('sha256', $token)]);
      save('sessions', $sessions);
    }
    set_session_cookie('', 0);
    out(['ok' => true]);

  case 'requestReset':
    if ($method !== 'POST') fail('Use POST.', 405);
    $to = (string) ($cfg['admin_email'] ?? '');
    if (!$to) fail('No reset email address is set up. Use a GitHub token instead.', 409);
    if (too_many('reset', 3, 3600)) fail('A reset email was sent recently. Check your inbox (and spam), or try again in an hour.', 429);
    note_hit('reset', 3600);
    $token = bin2hex(random_bytes(32));
    save('reset', ['hash' => hash('sha256', $token), 'expires' => time() + 3600]);
    $site = rtrim((string) ($cfg['site_url'] ?? ''), '/') . '/';
    $host = parse_url($site, PHP_URL_HOST) ?: 'localhost';
    $link = $site . '?reset=' . $token;
    $body = "Someone (hopefully you) asked to set or reset the password for your site editor.\n\n"
          . "Choose a new password here (link works for 1 hour, once):\n$link\n\n"
          . "If this wasn't you, ignore this email — nothing changes.\n";
    $sent = @mail($to, 'Your site editor password', $body,
      "From: Site editor <noreply@$host>\r\nContent-Type: text/plain; charset=utf-8", '-fnoreply@' . $host);
    if (!$sent) fail('The server could not send the email. Use a GitHub token to reset instead.', 502);
    out(['ok' => true]);

  case 'reset':
    if ($method !== 'POST') fail('Use POST.', 405);
    if (!configured()) fail('The editor server is not set up yet.', 503);
    if (too_many('login', 8, 900)) fail('Too many attempts. Try again in 15 minutes.', 429);
    $in = input();
    $password = (string) ($in['password'] ?? '');
    if (!empty($in['resetToken'])) {
      $r = load('reset', []);
      $ok = !empty($r['hash']) && ($r['expires'] ?? 0) > time() && hash_equals($r['hash'], hash('sha256', (string) $in['resetToken']));
      if (!$ok) { note_hit('login', 900); fail('This reset link has expired or was already used. Ask for a new one.', 401); }
    } elseif (!empty($in['githubToken'])) {
      // Proves ownership: the token must be able to write to this site's repository
      $repoInfo = gh('GET', '', null, false, trim((string) $in['githubToken']));
      if (isset($repoInfo['__error']) || empty($repoInfo['permissions']['push'])) { note_hit('login', 900); fail('That GitHub token can’t write to ' . $cfg['repo'] . '.', 401); }
    } else {
      fail('Missing reset link or GitHub token.');
    }
    set_password($password);
    out(['ok' => true]);

  case 'changePassword':
    if ($method !== 'POST') fail('Use POST.', 405);
    require_signed_in();
    $in = input();
    $auth = load('auth', []);
    if (!password_verify((string) ($in['current'] ?? ''), $auth['hash'] ?? '')) { note_hit('login', 900); fail('Your current password is not right.', 401); }
    set_password((string) ($in['password'] ?? ''));
    out(['ok' => true]);

  case 'content':
    require_signed_in();
    $raw = gh_ok(gh('GET', '/contents/content.json?ref=' . rawurlencode($cfg['branch'] ?? 'main'), null, true), 'Loading content');
    header('Content-Type: application/json; charset=utf-8');
    echo $raw;
    exit;

  case 'publish':
    if ($method !== 'POST') fail('Use POST.', 405);
    require_signed_in();
    $content = json_decode((string) file_get_contents('php://input'));
    if (!is_object($content) || empty($content->sections) || !isset($content->projects)) fail('That doesn’t look like site content.');
    $files = [];
    extract_images($content, $files);
    $branch = $cfg['branch'] ?? 'main';
    $ref = gh_ok(gh('GET', '/git/ref/heads/' . rawurlencode($branch)), 'Reading the site');
    $parent = gh_ok(gh('GET', '/git/commits/' . $ref['object']['sha']), 'Reading the site');
    $tree = [];
    foreach ($files as $path => $b64) {
      $blob = gh_ok(gh('POST', '/git/blobs', ['content' => $b64, 'encoding' => 'base64']), 'Uploading an image');
      $tree[] = ['path' => $path, 'mode' => '100644', 'type' => 'blob', 'sha' => $blob['sha']];
    }
    $json = gh_ok(gh('POST', '/git/blobs', ['content' => json_encode($content, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n", 'encoding' => 'utf-8']), 'Saving content');
    $tree[] = ['path' => 'content.json', 'mode' => '100644', 'type' => 'blob', 'sha' => $json['sha']];
    $newTree = gh_ok(gh('POST', '/git/trees', ['base_tree' => $parent['tree']['sha'], 'tree' => $tree]), 'Saving content');
    $commit = gh_ok(gh('POST', '/git/commits', ['message' => 'Update site content (via editor)', 'tree' => $newTree['sha'], 'parents' => [$ref['object']['sha']]]), 'Saving content');
    $update = gh('PATCH', '/git/refs/heads/' . rawurlencode($branch), ['sha' => $commit['sha']]);
    if (isset($update['__error'])) {
      if ($update['__status'] === 422) fail('The site was changed on GitHub since you opened the editor. Reload the page and try again.', 409);
      gh_ok($update, 'Publishing');
    }
    out(['ok' => true, 'commit' => $commit['sha'], 'images' => count($files)]);

  default:
    fail('Unknown action.', 404);
}
