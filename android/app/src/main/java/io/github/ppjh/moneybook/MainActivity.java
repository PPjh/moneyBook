package io.github.ppjh.moneybook;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** The exact bundled Web UI, with a local-only, allow-listed native persistence/SAF bridge. */
public final class MainActivity extends Activity {
  private static final String HOST = "appassets.androidplatform.net";
  private static final String HOME = "https://" + HOST + "/assets/index.html";
  private static final int PICK_FOLDER = 20, PICK_IMPORT = 21, SAVE_FILE = 22;
  private static final Set<String> ASSETS =
      new HashSet<>(
          Arrays.asList(
              "index.html",
              "native-adapter.js",
              "manifest.json",
              "icon-192.png",
              "icon-512.png",
              "icon-maskable-512.png"));
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final Object operations = new Object();
  private final List<Runnable> deferred = new ArrayList<>();
  private SharedPreferences preferences;
  private LedgerDatabase database;
  private NativeFiles files;
  private WebView web;
  private Bridge bridge;
  private FrameLayout root;
  private TextView startupMessage;
  private String pickerId, pickerOperation, pendingContent;
  private boolean ready, destroyed;
  private volatile boolean unlocked;
  private volatile long backgroundAt;
  private BiometricAuth authentication;
  private LinearLayout lockGate;
  private TextView lockMessage;
  private volatile boolean biometricEnabled, migratingPin;
  private boolean resumed, autoAuthAttempted;
  private volatile int pageGeneration;
  private Runnable verifiedOnResume;
  private String authenticationMessage = "";

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    preferences = getSharedPreferences("settings", MODE_PRIVATE);
    biometricEnabled = preferences.getBoolean("biometricEnabled", false);
    migratingPin = !preferences.getString("pin", "").isEmpty();
    authentication = new BiometricAuth(this);
    try {
      database = new LedgerDatabase(this);
      database.getWritableDatabase();
      files = new NativeFiles(this, preferences, database);
      unlocked = !hasLock();
      bridge = new Bridge();
      root = new FrameLayout(this);
      setContentView(root);
      setChrome(configuration().optString("theme", "system"));
      getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
      if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
      root.setOnApplyWindowInsetsListener(
          (view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
              android.graphics.Insets safe =
                  insets.getInsets(
                      WindowInsets.Type.systemBars()
                          | WindowInsets.Type.displayCutout()
                          | WindowInsets.Type.ime());
              view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
              // This root owns the safe area. Do not send the same insets to WebView/CSS again.
              return WindowInsets.CONSUMED;
            }
            int left = insets.getSystemWindowInsetLeft(), top = insets.getSystemWindowInsetTop();
            int right = insets.getSystemWindowInsetRight(),
                bottom = insets.getSystemWindowInsetBottom();
            if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
              android.view.DisplayCutout cutout = insets.getDisplayCutout();
              left = Math.max(left, cutout.getSafeInsetLeft());
              top = Math.max(top, cutout.getSafeInsetTop());
              right = Math.max(right, cutout.getSafeInsetRight());
              bottom = Math.max(bottom, cutout.getSafeInsetBottom());
            }
            view.setPadding(left, top, right, bottom);
            WindowInsets consumed = insets.consumeSystemWindowInsets().consumeStableInsets();
            return Build.VERSION.SDK_INT >= 28 ? consumed.consumeDisplayCutout() : consumed;
          });
      root.requestApplyInsets();
      web = new WebView(this);
      web.setVisibility(View.INVISIBLE); // Only the native gate may expose a protected ledger.
      web.setBackgroundColor(Color.TRANSPARENT);
      WebSettings settings = web.getSettings();
      settings.setJavaScriptEnabled(true);
      settings.setDomStorageEnabled(false); // All durable state remains in SQLite/native files.
      settings.setAllowFileAccess(false);
      settings.setAllowContentAccess(false);
      settings.setAllowFileAccessFromFileURLs(false);
      settings.setAllowUniversalAccessFromFileURLs(false);
      settings.setBlockNetworkLoads(true);
      settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
      settings.setJavaScriptCanOpenWindowsAutomatically(false);
      settings.setSupportMultipleWindows(false);
      settings.setTextZoom(100);
      WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
      web.addJavascriptInterface(bridge, "MoneyBookNative");
      web.setWebViewClient(new LocalClient());
      web.setWebChromeClient(
          new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
              new AlertDialog.Builder(MainActivity.this)
                  .setTitle("轻记账")
                  .setMessage(message)
                  .setPositiveButton("确定", (d, w) -> result.confirm())
                  .setOnCancelListener(d -> result.cancel())
                  .show();
              return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
              new AlertDialog.Builder(MainActivity.this)
                  .setTitle("轻记账")
                  .setMessage(message)
                  .setPositiveButton("确定", (d, w) -> result.confirm())
                  .setNegativeButton("取消", (d, w) -> result.cancel())
                  .setOnCancelListener(d -> result.cancel())
                  .show();
              return true;
            }

            @Override
            public boolean onShowFileChooser(
                WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
              callback.onReceiveValue(
                  null); // Import is explicitly routed through the native document picker.
              return true;
            }
          });
      root.addView(web, new FrameLayout.LayoutParams(-1, -1));
      startupMessage = new TextView(this);
      startupMessage.setText("正在打开本机账本…");
      startupMessage.setPadding(32, 100, 32, 32);
      root.addView(startupMessage, new FrameLayout.LayoutParams(-1, -1));
      createLockGate();
      // Configuration changes are handled in-place, so drafts, pending pickers and native grants
      // survive.
      web.loadUrl(HOME);
      if (Build.VERSION.SDK_INT >= 33)
        getOnBackInvokedDispatcher()
            .registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
    } catch (Exception error) {
      TextView message = new TextView(this);
      message.setText("无法打开本机账本。为保护数据，没有清空或重建数据库。\n\n" + error.getMessage());
      message.setPadding(32, 100, 32, 32);
      setContentView(message);
    }
  }

  private final class LocalClient extends WebViewClient {
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      return !isHome(request.getUrl());
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
      return !isHome(Uri.parse(url));
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
      Uri uri = request.getUrl();
      try {
        String name = uri.getPath() == null ? "" : uri.getPath().replaceFirst("^/assets/", "");
        if (!"https".equals(uri.getScheme())
            || !HOST.equals(uri.getHost())
            || uri.getPort() != -1
            || !uri.getPath().equals("/assets/" + name)
            || !ASSETS.contains(name)
            || !"GET".equals(request.getMethod())) return denied();
        byte[] content;
        try (java.io.InputStream input = getAssets().open(name);
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
          byte[] chunk = new byte[8192];
          int n;
          while ((n = input.read(chunk)) != -1) bytes.write(chunk, 0, n);
          content = bytes.toByteArray();
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        if (name.equals("index.html")) {
          String nonce = UUID.randomUUID().toString();
          String html =
              new String(content, StandardCharsets.UTF_8)
                  .replace(
                      "<script>",
                      "<script nonce=\""
                          + nonce
                          + "\" src=\"native-adapter.js\"></script><script nonce=\""
                          + nonce
                          + "\">");
          content = html.getBytes(StandardCharsets.UTF_8);
          headers.put(
              "Content-Security-Policy",
              "default-src 'none'; script-src 'nonce-"
                  + nonce
                  + "'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none';"
                  + " frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
        }
        String mime =
            name.endsWith(".html")
                ? "text/html"
                : name.endsWith(".js")
                    ? "text/javascript"
                    : name.endsWith(".json") ? "application/json" : "image/png";
        return new WebResourceResponse(
            mime, "UTF-8", 200, "OK", headers, new ByteArrayInputStream(content));
      } catch (Exception error) {
        return denied();
      }
    }

    @Override
    public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
      ++pageGeneration;
      authentication.cancel();
      verifiedOnResume = null;
      autoAuthAttempted = false;
      ready = false;
      view.setVisibility(View.INVISIBLE);
      if (startupMessage == null) {
        startupMessage = new TextView(MainActivity.this);
        startupMessage.setText("正在打开本机账本…");
        startupMessage.setPadding(32, 100, 32, 32);
        root.addView(startupMessage, new FrameLayout.LayoutParams(-1, -1));
      }
      if (!isHome(Uri.parse(url))) {
        view.stopLoading();
        return;
      }
      unlocked = !hasLock();
      if (lockGate != null) lockGate.setVisibility(View.GONE);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
      handler.postDelayed(
          () -> {
            if (!ready && !destroyed && startupMessage != null) {
              startupMessage.setText("界面未能启动，已停止写入。\n本机账目仍保留，请勿卸载或清除数据。\n\n点击此处重试。");
              startupMessage.setOnClickListener(v -> recreate());
            }
          },
          3000);
    }

    @Override
    public boolean onRenderProcessGone(
        WebView view, android.webkit.RenderProcessGoneDetail detail) {
      // Do not reset storage to conceal a failed renderer; reload with a fresh PIN session.
      root.removeView(view);
      view.destroy();
      web = null;
      recreate();
      return true;
    }
  }

  private static WebResourceResponse denied() {
    return new WebResourceResponse(
        "text/plain",
        "UTF-8",
        403,
        "Blocked",
        new HashMap<>(),
        new ByteArrayInputStream(new byte[0]));
  }

  private boolean isHome(Uri uri) {
    return "https".equals(uri.getScheme())
        && HOST.equals(uri.getHost())
        && uri.getPort() == -1
        && "/assets/index.html".equals(uri.getPath())
        && uri.getQuery() == null;
  }

  private boolean hasLock() {
    return LockPolicy.enabled(biometricEnabled, migratingPin);
  }

  private int dp(int value) {
    return Math.round(value * getResources().getDisplayMetrics().density);
  }

  private void createLockGate() {
    lockGate = new LinearLayout(this);
    lockGate.setOrientation(LinearLayout.VERTICAL);
    lockGate.setGravity(Gravity.CENTER);
    lockGate.setPadding(dp(28), dp(24), dp(28), dp(24));
    lockGate.setVisibility(View.GONE);
    ImageView icon = new ImageView(this);
    icon.setImageResource(R.mipmap.ic_launcher);
    icon.setContentDescription("轻记账");
    lockGate.addView(icon, new LinearLayout.LayoutParams(dp(76), dp(76)));
    lockMessage = new TextView(this);
    lockMessage.setTextSize(16);
    lockMessage.setGravity(Gravity.CENTER);
    lockMessage.setPadding(0, dp(22), 0, dp(20));
    lockGate.addView(lockMessage, new LinearLayout.LayoutParams(-1, -2));
    Button unlock = new Button(this);
    unlock.setText("指纹解锁");
    unlock.setOnClickListener(v -> beginAuthentication(null, "unlock", false));
    lockGate.addView(unlock, new LinearLayout.LayoutParams(-1, dp(52)));
    Button credential = new Button(this);
    credential.setText("使用手机锁屏密码");
    credential.setOnClickListener(v -> beginAuthentication(null, "unlock", true));
    lockGate.addView(credential, new LinearLayout.LayoutParams(-1, dp(52)));
    Button settings = new Button(this);
    settings.setText("系统指纹设置");
    settings.setOnClickListener(
        v -> {
          try {
            authentication.settings();
          } catch (RuntimeException error) {
            authenticationMessage = "无法打开系统设置，请手动到手机设置中录入指纹";
            renderLockGate(false);
          }
        });
    lockGate.addView(settings, new LinearLayout.LayoutParams(-1, dp(52)));
    root.addView(lockGate, new FrameLayout.LayoutParams(-1, -1));
    try {
      setChrome(configuration().optString("theme", "system"));
    } catch (Exception ignored) {
    }
  }

  private void renderLockGate(boolean automatic) {
    if (!ready || destroyed || web == null || lockGate == null) return;
    boolean locked = hasLock() && !unlocked;
    web.setVisibility(locked ? View.INVISIBLE : View.VISIBLE);
    web.setImportantForAccessibility(
        locked
            ? View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            : View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
    lockGate.setVisibility(locked ? View.VISIBLE : View.GONE);
    if (locked) {
      lockMessage.setText(
          "轻记账 · 指纹解锁\n\n"
              + (migratingPin ? "旧 PIN 将在系统验证成功后移除，账目不变。\n\n" : "")
              + (authenticationMessage.isEmpty()
                  ? "请使用系统指纹验证，或使用手机锁屏密码。\n应用不会读取或保存指纹。"
                  : authenticationMessage));
      if (automatic && resumed && !autoAuthAttempted && !authentication.busy()) {
        autoAuthAttempted = true;
        handler.post(() -> beginAuthentication(null, "unlock", false));
      }
    }
  }

  private void completeAuthentication(String id, Object value, Exception error) {
    // Auth cancellation must reach the UI even while locked; never queue it with ledger/file data.
    if (id != null)
      evaluate(
          "window.__moneybookResolve&&window.__moneybookResolve("
              + JSONObject.quote(id)
              + ","
              + reply(value, error)
              + ");");
  }

  private void beginAuthentication(String id, String action, boolean credentialOnly) {
    final int page = pageGeneration;
    try {
      if (!ready || !resumed || destroyed) throw new SecurityException("请返回轻记账后重试验证");
      if (!LockPolicy.validAction(action)) throw new SecurityException("不支持的验证操作");
      if (!"unlock".equals(action)) requireUnlocked();
      if ("enable".equals(action) && !authentication.available())
        throw new IllegalStateException("请先到系统设置中录入指纹，再开启指纹解锁");
      authentication.authenticate(
          "disable".equals(action) ? "验证后关闭指纹解锁" : "轻记账 · 指纹解锁",
          credentialOnly,
          (success, message) -> {
            long verifiedAt = SystemClock.elapsedRealtime();
            Runnable finish =
                () -> {
                  if (page != pageGeneration || destroyed) return;
                  try {
                    if (!LockPolicy.accept(success, page, pageGeneration, destroyed)
                        || SystemClock.elapsedRealtime() - verifiedAt > 10_000)
                      throw new SecurityException(message.isEmpty() ? "验证已失效，请重试" : message);
                    synchronized (operations) {
                      boolean next =
                          "disable".equals(action)
                              ? false
                              : "enable".equals(action) || migratingPin || biometricEnabled;
                      // Only a verified native callback changes these settings. Failure keeps the
                      // in-memory gate.
                      if (!preferences
                          .edit()
                          .putBoolean("biometricEnabled", next)
                          .remove("pin")
                          .remove("pinLength")
                          .remove("pinFailures")
                          .remove("pinBlockedUntil")
                          .commit()) throw new IllegalStateException("解锁设置保存失败，请重试；原保护仍保留");
                      biometricEnabled = next;
                      migratingPin = false;
                      unlocked = true;
                      backgroundAt = 0;
                    }
                    authenticationMessage = "";
                    setChrome(configuration().optString("theme", "system"));
                    renderLockGate(false);
                    evaluate("window.MoneyBookPlatform&&window.MoneyBookPlatform.resume(false);");
                    completeAuthentication(id, authentication.info(hasLock(), migratingPin), null);
                    flushDeferred();
                  } catch (Exception error) {
                    authenticationMessage = error.getMessage();
                    renderLockGate(false);
                    completeAuthentication(id, null, error);
                  }
                };
            // Legacy system-credential results can arrive just before Activity.onResume().
            if (success && !resumed) verifiedOnResume = finish;
            else finish.run();
          });
    } catch (Exception error) {
      authenticationMessage = error.getMessage();
      renderLockGate(false);
      completeAuthentication(id, null, error);
    }
  }

  private void setChrome(String theme) {
    boolean dark =
        "dark".equals(theme)
            || ("system".equals(theme)
                && (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                    == Configuration.UI_MODE_NIGHT_YES);
    int color = dark ? 0xff1c1510 : 0xfffff8f1;
    getWindow().setStatusBarColor(color);
    getWindow().setNavigationBarColor(color);
    int appearance =
        dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
    if (Build.VERSION.SDK_INT < 30) {
      // Match setDecorFitsSystemWindows(false) on older Android, with insets owned by the root.
      appearance |=
          View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
    }
    getWindow().getDecorView().setSystemUiVisibility(appearance);
    if (root != null) root.setBackgroundColor(color);
    if (lockGate != null) {
      lockGate.setBackgroundColor(color);
      lockMessage.setTextColor(dark ? 0xfffff0e4 : 0xff3c291d);
    }
    if (hasLock()) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
  }

  private JSONObject configuration() throws Exception {
    String raw = database.state(SharedUiState.CONFIG);
    JSONObject config;
    if (raw == null) {
      JSONObject budgets = new JSONObject();
      for (Map.Entry<String, Long> entry : database.budgets().entrySet())
        budgets.put(entry.getKey(), entry.getValue());
      config =
          SharedUiState.cleanConfig(
              new JSONObject()
                  .put("theme", preferences.getString("theme", "system"))
                  .put("lockDelay", preferences.getLong("lockDelay", 60_000))
                  .put("snapOn", preferences.getBoolean("snapOn", true))
                  .put("autoExport", preferences.getString("autoBackup", "weekly"))
                  .put("lastSnap", preferences.getString("lastSnapshotDay", ""))
                  .put("lastExport", preferences.getLong("lastBackup", 0))
                  .put("lastFolderBackup", preferences.getLong("lastBackup", 0))
                  .put("budgets", budgets)
                  .put("backupTarget", "folder")
                  .put(
                      "lastCat",
                      new JSONObject()
                          .put("expense", preferences.getString("last.expense", "餐饮"))
                          .put("income", preferences.getString("last.income", "工资"))));
      database.state(SharedUiState.CONFIG, config.toString());
    } else config = new JSONObject(raw);
    if (!preferences.getString("backupUri", "").isEmpty()) config.put("backupTarget", "folder");
    config.put("pin", JSONObject.NULL);
    config.put("biometric", authentication.info(hasLock(), migratingPin));
    return config;
  }

  private void requireUnlocked() throws Exception {
    long delay = configuration().optLong("lockDelay", 60_000);
    if (LockPolicy.expired(hasLock(), backgroundAt, SystemClock.elapsedRealtime(), delay))
      unlocked = false;
    if (!unlocked && hasLock()) throw new SecurityException("请先使用指纹解锁账本");
  }

  private static String reply(Object value, Exception error) {
    try {
      return error == null
          ? new JSONObject()
              .put("ok", true)
              .put("value", value == null ? JSONObject.NULL : value)
              .toString()
          : new JSONObject()
              .put("ok", false)
              .put("error", error.getMessage() == null ? "操作未完成" : error.getMessage())
              .toString();
    } catch (Exception impossible) {
      return "{\"ok\":false,\"error\":\"返回数据失败\"}";
    }
  }

  private void evaluate(String javascript) {
    if (!destroyed && web != null) web.evaluateJavascript(javascript, null);
  }

  private void complete(String id, Object value, Exception error) {
    String script =
        "window.__moneybookResolve&&window.__moneybookResolve("
            + JSONObject.quote(id)
            + ","
            + reply(value, error)
            + ");";
    handler.post(
        () -> {
          Runnable callback = () -> evaluate(script);
          if (!ready || (hasLock() && !unlocked)) deferred.add(callback);
          else callback.run();
        });
  }

  private void flushDeferred() {
    if (!ready || (hasLock() && !unlocked)) return;
    List<Runnable> callbacks = new ArrayList<>(deferred);
    deferred.clear();
    for (Runnable callback : callbacks) callback.run();
  }

  private JSONObject folderInfo() throws Exception {
    boolean selected = !preferences.getString("backupUri", "").isEmpty();
    return new JSONObject()
        .put("selected", selected)
        .put("name", preferences.getString("backupName", ""))
        .put("granted", selected && files.hasDirectoryPermission())
        .put("error", preferences.getString("backupError", ""));
  }

  private JSONArray snapshots() throws Exception {
    JSONArray list = new JSONArray();
    for (File file : files.snapshots()) {
      try {
        JSONObject backup = new JSONObject(files.readSnapshot(file));
        String[] parts = file.getName().split("-", 3);
        long time = Long.parseLong(parts[0]);
        JSONArray rows = backup.getJSONArray("records");
        long total = 0;
        for (int i = 0; i < rows.length(); i++)
          if (!"income".equals(rows.getJSONObject(i).optString("type")))
            total += rows.getJSONObject(i).getLong("amount");
        list.put(
            new JSONObject()
                .put("nativeId", file.getName())
                .put("ts", time)
                .put("reason", parts[1])
                .put(
                    "date",
                    java.time.Instant.ofEpochMilli(time)
                        .atZone(java.time.ZoneId.systemDefault())
                        .toLocalDate()
                        .toString())
                .put("n", rows.length())
                .put("total", total)
                .put("rows", rows)
                .put("config", backup.optJSONObject("config")));
      } catch (Exception unreadable) {
        // One damaged snapshot must neither break startup/PIN nor delete the original file.
        list.put(
            new JSONObject()
                .put("nativeId", file.getName())
                .put("ts", file.lastModified())
                .put("corrupt", true)
                .put("n", 0)
                .put("total", 0)
                .put("rows", new JSONArray()));
      }
    }
    return list;
  }

  public final class Bridge {
    @JavascriptInterface
    public String call(String operation, String arguments) {
      synchronized (operations) {
        try {
          JSONObject args = new JSONObject(arguments);
          switch (operation) {
            case "info":
              return reply(new JSONObject().put("version", BuildConfig.VERSION_NAME), null);
            case "biometricInfo":
              return reply(authentication.info(hasLock(), migratingPin), null);
            case "get":
              {
                String key = args.getString("key");
                if (SharedUiState.RECORDS.equals(key)) return reply(database.recordsJson(), null);
                if (SharedUiState.CONFIG.equals(key))
                  return reply(configuration().toString(), null);
                if ("jz.recovery.v1".equals(key)) return reply(database.state(key), null);
                return reply(null, null);
              }
            case "set":
              {
                requireUnlocked();
                String key = args.getString("key"), value = args.getString("value");
                if (SharedUiState.RECORDS.equals(key))
                  database.replaceRecords(value, args.getString("expected"));
                else if (SharedUiState.CONFIG.equals(key)) {
                  JSONObject next = new JSONObject(value), current = configuration();
                  // A theme/budget edit queued during backup must not erase its new success time.
                  next.put(
                      "lastFolderBackup",
                      Math.max(
                          next.optLong("lastFolderBackup", 0),
                          current.optLong("lastFolderBackup", 0)));
                  next.put(
                      "lastExport",
                      Math.max(next.optLong("lastExport", 0), current.optLong("lastExport", 0)));
                  database.configure(next);
                } else if ("jz.recovery.v1".equals(key)) database.state(key, value);
                else throw new SecurityException("不允许写入此存储项");
                return reply(true, null);
              }
            case "folder":
              return reply(folderInfo(), null);
            case "snapshots":
              return reply(snapshots(), null);
            case "snapshot":
              {
                requireUnlocked();
                files.snapshot(args.getString("reason"));
                return reply(snapshots().getJSONObject(0), null);
              }
            case "retainSnapshots":
              {
                requireUnlocked();
                JSONArray keep = args.getJSONArray("keep");
                Set<String> names = new HashSet<>();
                for (int i = 0; i < keep.length(); i++) names.add(keep.getString(i));
                for (File file : files.snapshots())
                  if (!names.contains(file.getName()) && !file.delete())
                    throw new IllegalStateException("快照删除失败");
                return reply(true, null);
              }
            case "import":
              {
                requireUnlocked();
                if (!database.recordsJson().equals(args.getString("expected")))
                  throw new IllegalStateException("账本已更新，请重新加载后再恢复");
                Ledger.ImportData data =
                    Ledger.parse(
                        new JSONObject()
                            .put("records", args.getJSONArray("rows"))
                            .put("config", args.optJSONObject("config"))
                            .toString());
                int before = database.entries().size();
                if (before > 0) files.snapshot("import");
                int added = database.importData(data, "replace".equals(args.getString("mode")));
                return reply(
                    new JSONObject()
                        .put("ok", true)
                        .put("before", before)
                        .put("after", database.entries().size())
                        .put("added", added)
                        .put("budgetSaved", true),
                    null);
              }
            case "lock":
              boolean previouslyUnlocked = unlocked;
              unlocked = !hasLock();
              handler.post(
                  () -> {
                    if (previouslyUnlocked && !unlocked) autoAuthAttempted = false;
                    renderLockGate(true);
                  });
              return reply(true, null);
            case "theme":
              handler.post(() -> setChrome(args.optString("theme", "system")));
              return reply(true, null);
            case "ready":
              handler.post(
                  () -> {
                    ready = true;
                    if (startupMessage != null) {
                      root.removeView(startupMessage);
                      startupMessage = null;
                    }
                    renderLockGate(true);
                    flushDeferred();
                  });
              return reply(true, null);
            default:
              throw new SecurityException("不支持的本机操作");
          }
        } catch (Exception error) {
          return reply(null, error);
        }
      }
    }

    @JavascriptInterface
    public void request(String id, String operation, String arguments) {
      try {
        JSONObject args = new JSONObject(arguments);
        if ("biometricAuth".equals(operation)) {
          handler.post(
              () ->
                  beginAuthentication(
                      id, args.optString("action"), args.optBoolean("credentialOnly")));
          return;
        }
        if ("biometricSettings".equals(operation)) {
          handler.post(
              () -> {
                try {
                  authentication.settings();
                  completeAuthentication(id, true, null);
                } catch (Exception error) {
                  completeAuthentication(id, null, error);
                }
              });
          return;
        }
        synchronized (operations) {
          requireUnlocked();
        }
        if ("chooseFolder".equals(operation)
            || "importFile".equals(operation)
            || "saveFile".equals(operation)) {
          handler.post(() -> launchPicker(id, operation, args));
          return;
        }
        executor.execute(
            () -> {
              synchronized (operations) {
                try {
                  requireUnlocked();
                  Object result;
                  if ("backup".equals(operation)) {
                    result = files.fixedBackup();
                  } else if ("forgetFolder".equals(operation)) {
                    files.forgetDirectory();
                    JSONObject config = configuration().put("backupTarget", "download");
                    database.configure(config);
                    result = true;
                  } else throw new SecurityException("不支持的异步操作");
                  complete(id, result, null);
                } catch (Exception error) {
                  complete(id, null, error);
                }
              }
            });
      } catch (Exception error) {
        complete(id, null, error);
      }
    }
  }

  private void launchPicker(String id, String operation, JSONObject args) {
    try {
      requireUnlocked();
      if (pickerId != null) throw new IllegalStateException("请先完成上一次文件选择");
      Intent intent;
      int code;
      if ("chooseFolder".equals(operation)) {
        intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        code = PICK_FOLDER;
      } else if ("importFile".equals(operation)) {
        intent =
            new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*");
        code = PICK_IMPORT;
      } else {
        intent =
            new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(args.optString("mime", "application/json"))
                .putExtra(Intent.EXTRA_TITLE, args.getString("name"));
        pendingContent = args.getString("text");
        code = SAVE_FILE;
      }
      pickerId = id;
      pickerOperation = operation;
      startActivityForResult(intent, code);
    } catch (Exception error) {
      pickerId = null;
      pickerOperation = null;
      pendingContent = null;
      complete(id, null, error);
    }
  }

  @Override
  protected void onActivityResult(int code, int result, Intent data) {
    super.onActivityResult(code, result, data);
    if (authentication != null && authentication.activityResult(code, result)) return;
    String id = pickerId, operation = pickerOperation, content = pendingContent;
    pickerId = null;
    pickerOperation = null;
    pendingContent = null;
    if (id == null) return;
    if (result != RESULT_OK || data == null || data.getData() == null) {
      complete(id, null, new IllegalStateException("已取消"));
      return;
    }
    Uri uri = data.getData();
    int flags = data.getFlags();
    // Returning from a picker may require unlocking. Defer the job itself, not just its result.
    Runnable job =
        () ->
            executor.execute(
                () -> {
                  synchronized (operations) {
                    try {
                      requireUnlocked();
                      Object value;
                      if ("chooseFolder".equals(operation)) {
                        files.rememberDirectory(uri, flags);
                        JSONObject config =
                            configuration()
                                .put("backupTarget", "folder")
                                .put("lastFolderBackup", 0);
                        database.configure(config);
                        value = folderInfo();
                      } else if ("importFile".equals(operation)) value = files.read(uri);
                      else {
                        files.write(uri, content);
                        value = true;
                      }
                      complete(id, value, null);
                    } catch (Exception error) {
                      complete(id, null, error);
                    }
                  }
                });
    handler.post(
        () -> {
          if (hasLock() && !unlocked) deferred.add(job);
          else job.run();
        });
  }

  private void handleBack() {
    if (hasLock() && !unlocked) {
      authentication.cancel();
      moveTaskToBack(true);
      return;
    }
    if (!ready || web == null) {
      moveTaskToBack(true);
      return;
    }
    web.evaluateJavascript(
        "window.MoneyBookPlatform?window.MoneyBookPlatform.back():false",
        consumed -> {
          if (!"true".equals(consumed)) moveTaskToBack(true);
        });
  }

  @Override
  public void onBackPressed() {
    handleBack();
  }

  @Override
  protected void onStop() {
    backgroundAt = SystemClock.elapsedRealtime();
    if (authentication != null && !authentication.waitingForCredential()) authentication.cancel();
    super.onStop();
  }

  @Override
  protected void onPause() {
    resumed = false;
    super.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    resumed = true;
    if (database == null || bridge == null) return;
    boolean previouslyUnlocked = unlocked;
    try {
      requireUnlocked();
    } catch (Exception error) {
      unlocked = false;
    }
    if (previouslyUnlocked && !unlocked) autoAuthAttempted = false;
    if (verifiedOnResume != null) {
      Runnable verified = verifiedOnResume;
      verifiedOnResume = null;
      verified.run();
    }
    boolean lock = hasLock() && !unlocked;
    backgroundAt = 0;
    if (ready) evaluate("window.MoneyBookPlatform&&window.MoneyBookPlatform.resume(" + lock + ");");
    renderLockGate(true);
  }

  @Override
  public void onConfigurationChanged(Configuration config) {
    super.onConfigurationChanged(config);
    try {
      setChrome(configuration().optString("theme", "system"));
    } catch (Exception ignored) {
    }
  }

  @Override
  protected void onDestroy() {
    destroyed = true;
    if (authentication != null) authentication.cancel();
    verifiedOnResume = null;
    handler.removeCallbacksAndMessages(null);
    deferred.clear();
    if (web != null) {
      web.removeJavascriptInterface("MoneyBookNative");
      root.removeView(web);
      web.destroy();
      web = null;
    }
    if (database != null) executor.execute(database::close);
    executor.shutdown();
    super.onDestroy();
  }
}
