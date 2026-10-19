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
import android.widget.EditText;
import android.widget.FrameLayout;
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

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    preferences = getSharedPreferences("settings", MODE_PRIVATE);
    try {
      database = new LedgerDatabase(this);
      database.getWritableDatabase();
      files = new NativeFiles(this, preferences, database);
      unlocked = !hasPin();
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
      web.setVisibility(
          View.INVISIBLE); // Do not expose an uninitialised page before its PIN screen is ready.
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
      unlocked = !hasPin();
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

  private boolean hasPin() {
    return !preferences.getString("pin", "").isEmpty();
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
    if (hasPin()) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
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
    JSONObject pin = SharedUiState.publicPin(hasPin(), preferences.getInt("pinLength", 0));
    config.put("pin", pin == null ? JSONObject.NULL : pin);
    return config;
  }

  private void requireUnlocked() throws Exception {
    long delay = configuration().optLong("lockDelay", 60_000);
    if (hasPin()
        && backgroundAt > 0
        && delay >= 0
        && SystemClock.elapsedRealtime() - backgroundAt >= delay) unlocked = false;
    if (!unlocked && hasPin()) throw new SecurityException("请先解锁账本");
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
          if (!ready || (hasPin() && !unlocked)) deferred.add(callback);
          else callback.run();
        });
  }

  private void flushDeferred() {
    if (!ready || (hasPin() && !unlocked)) return;
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
            case "pinVerify":
              {
                long until = preferences.getLong("pinBlockedUntil", 0);
                if (System.currentTimeMillis() < until) throw new SecurityException("连续错误，请稍后再试");
                String pin = args.getString("pin");
                boolean valid = PinLock.verify(pin, preferences.getString("pin", ""));
                if (valid) {
                  unlocked = true;
                  backgroundAt = 0;
                  preferences
                      .edit()
                      .putInt("pinLength", pin.length())
                      .remove("pinFailures")
                      .remove("pinBlockedUntil")
                      .commit();
                  handler.post(MainActivity.this::flushDeferred);
                } else {
                  int failures = preferences.getInt("pinFailures", 0) + 1;
                  SharedPreferences.Editor editor =
                      preferences.edit().putInt("pinFailures", failures >= 5 ? 0 : failures);
                  if (failures >= 5)
                    editor.putLong("pinBlockedUntil", System.currentTimeMillis() + 30_000);
                  editor.commit();
                }
                return reply(valid, null);
              }
            case "pinSet":
              {
                requireUnlocked();
                String pin = args.getString("pin");
                String encoded = PinLock.encode(pin);
                if (!preferences
                    .edit()
                    .putString("pin", encoded)
                    .putInt("pinLength", pin.length())
                    .commit()) throw new IllegalStateException("PIN 未能保存");
                handler.post(
                    () -> {
                      try {
                        setChrome(configuration().optString("theme", "system"));
                      } catch (Exception ignored) {
                      }
                    });
                return reply(SharedUiState.publicPin(true, pin.length()), null);
              }
            case "pinDisable":
              {
                requireUnlocked();
                if (!preferences.edit().remove("pin").remove("pinLength").commit())
                  throw new IllegalStateException("PIN 设置未能保存");
                handler.post(() -> getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE));
                return reply(true, null);
              }
            case "lock":
              unlocked = !hasPin();
              return reply(true, null);
            case "theme":
              handler.post(() -> setChrome(args.optString("theme", "system")));
              return reply(true, null);
            case "ready":
              if (hasPin() && !unlocked && !args.optBoolean("pinShown", false))
                throw new SecurityException("密码界面未能初始化，已停止显示账本");
              handler.post(
                  () -> {
                    ready = true;
                    if (web != null) web.setVisibility(View.VISIBLE);
                    if (startupMessage != null) {
                      root.removeView(startupMessage);
                      startupMessage = null;
                    }
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
        if ("forgotPin".equals(operation)) {
          handler.post(() -> forgotPin(id));
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
          if (hasPin() && !unlocked) deferred.add(job);
          else job.run();
        });
  }

  private void forgotPin(String id) {
    EditText confirmation = new EditText(this);
    confirmation.setHint("输入「清空」确认");
    int padding = Math.round(24 * getResources().getDisplayMetrics().density);
    confirmation.setPadding(padding, padding, padding, padding);
    AlertDialog dialog =
        new AlertDialog.Builder(this)
            .setTitle("清空数据并重置 PIN")
            .setMessage("此操作删除本机账目、预算、PIN 和全部本机快照，未备份数据无法恢复。外部备份保留。")
            .setView(confirmation)
            .setPositiveButton("确认清空", null)
            .setNegativeButton("取消", (d, w) -> complete(id, null, new IllegalStateException("已取消")))
            .setOnCancelListener(d -> complete(id, null, new IllegalStateException("已取消")))
            .create();
    dialog.setOnShowListener(
        v ->
            dialog
                .getButton(-1)
                .setOnClickListener(
                    button -> {
                      if (!"清空".equals(confirmation.getText().toString())) {
                        confirmation.setError("请输入「清空」");
                        return;
                      }
                      dialog.getButton(-1).setEnabled(false);
                      executor.execute(
                          () -> {
                            synchronized (operations) {
                              try {
                                database.clearLedger();
                                files.clearSnapshots();
                                if (!preferences.edit().clear().commit())
                                  throw new IllegalStateException("设置清理失败");
                                unlocked = true;
                                handler.post(
                                    () -> {
                                      deferred.clear();
                                      dialog.dismiss();
                                      complete(id, true, null);
                                    });
                              } catch (Exception error) {
                                handler.post(
                                    () -> {
                                      dialog.getButton(-1).setEnabled(true);
                                      confirmation.setError("重置未完成：" + error.getMessage());
                                    });
                              }
                            }
                          });
                    }));
    dialog.show();
  }

  private void handleBack() {
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
    super.onStop();
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (database == null || bridge == null) return;
    try {
      requireUnlocked();
    } catch (Exception error) {
      unlocked = false;
    }
    boolean lock = hasPin() && !unlocked;
    backgroundAt = 0;
    if (ready) evaluate("window.MoneyBookPlatform&&window.MoneyBookPlatform.resume(" + lock + ");");
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
