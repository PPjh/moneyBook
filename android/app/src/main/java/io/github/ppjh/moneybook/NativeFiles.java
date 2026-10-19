package io.github.ppjh.moneybook;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.AtomicFile;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import org.json.JSONObject;

/**
 * Android SAF and private atomic snapshots. All entry points run on the application's IO executor.
 */
public final class NativeFiles {
  private final Context context;
  private final SharedPreferences preferences;
  private final LedgerDatabase database;

  public NativeFiles(Context context, SharedPreferences preferences, LedgerDatabase database) {
    this.context = context;
    this.preferences = preferences;
    this.database = database;
  }

  public JSONObject backup() throws Exception {
    synchronized (database) {
      String storedConfig = database.state(SharedUiState.CONFIG);
      JSONObject config = storedConfig == null ? null : new JSONObject(storedConfig);
      JSONObject cats =
          new JSONObject()
              .put("expense", preferences.getString("last.expense", "餐饮"))
              .put("income", preferences.getString("last.income", "工资"));
      if (config != null && config.optJSONObject("lastCat") != null)
        cats = config.getJSONObject("lastCat");
      return Ledger.backup(
              database.entries(),
              database.budgets(),
              config == null
                  ? preferences.getString("theme", "system")
                  : config.optString("theme", "system"),
              cats)
          .put("appVersion", "android-" + BuildConfig.VERSION_NAME);
    }
  }

  public String filename(String extension) {
    return "轻记账-备份-"
        + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd-HHmmss-SSS"))
        + "-"
        + java.util.UUID.randomUUID().toString().substring(0, 6)
        + "."
        + extension;
  }

  public void rememberDirectory(Uri uri, int returnedFlags) throws Exception {
    int flags =
        returnedFlags
            & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    if ((flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0)
      throw new IOException("系统未授予文件夹写入权限");
    String oldUri = preferences.getString("backupUri", ""),
        oldName = preferences.getString("backupName", "");
    context.getContentResolver().takePersistableUriPermission(uri, flags);
    try {
      String name = directoryName(uri);
      if (!preferences
          .edit()
          .putString("backupUri", uri.toString())
          .putString("backupName", name)
          .remove("backupError")
          .commit()) {
        preferences.edit().putString("backupUri", oldUri).putString("backupName", oldName).apply();
        throw new IOException("无法保存备份位置");
      }
    } catch (Exception error) {
      if (!uri.toString().equals(oldUri))
        try {
          context.getContentResolver().releasePersistableUriPermission(uri, flags);
        } catch (Exception ignored) {
        }
      throw error;
    }
    if (!oldUri.isEmpty() && !uri.toString().equals(oldUri)) {
      for (UriPermission p : context.getContentResolver().getPersistedUriPermissions())
        if (p.getUri().toString().equals(oldUri)) {
          int oldFlags =
              (p.isReadPermission() ? Intent.FLAG_GRANT_READ_URI_PERMISSION : 0)
                  | (p.isWritePermission() ? Intent.FLAG_GRANT_WRITE_URI_PERMISSION : 0);
          try {
            context.getContentResolver().releasePersistableUriPermission(p.getUri(), oldFlags);
          } catch (Exception ignored) {
          }
        }
    }
  }

  public String directoryName(Uri tree) throws Exception {
    Uri doc =
        DocumentsContract.buildDocumentUriUsingTree(
            tree, DocumentsContract.getTreeDocumentId(tree));
    try (Cursor c =
        context
            .getContentResolver()
            .query(doc, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
      if (c != null && c.moveToFirst()) return c.getString(0);
    }
    throw new IOException("无法读取所选文件夹，请重新选择");
  }

  public boolean hasDirectoryPermission() {
    String stored = preferences.getString("backupUri", "");
    if (stored.isEmpty()) return false;
    for (UriPermission p : context.getContentResolver().getPersistedUriPermissions())
      if (p.getUri().toString().equals(stored) && p.isWritePermission()) return true;
    return false;
  }

  public void forgetDirectory() throws Exception {
    String stored = preferences.getString("backupUri", "");
    if (!preferences.edit().remove("backupUri").remove("backupName").remove("backupError").commit())
      throw new IOException("无法停用备份位置");
    for (UriPermission p : context.getContentResolver().getPersistedUriPermissions())
      if (p.getUri().toString().equals(stored)) {
        int flags =
            (p.isReadPermission() ? Intent.FLAG_GRANT_READ_URI_PERMISSION : 0)
                | (p.isWritePermission() ? Intent.FLAG_GRANT_WRITE_URI_PERMISSION : 0);
        context.getContentResolver().releasePersistableUriPermission(p.getUri(), flags);
      }
  }

  public boolean due() {
    String cycle = preferences.getString("autoBackup", "weekly");
    if ("off".equals(cycle)) return false;
    long days = "daily".equals(cycle) ? 1 : "monthly".equals(cycle) ? 30 : 7;
    return System.currentTimeMillis() - preferences.getLong("lastBackup", 0) >= days * 86_400_000L;
  }

  public String fixedBackup() throws Exception {
    if (!hasDirectoryPermission()) throw new IOException("备份文件夹访问已失效，请重新选择位置");
    Uri tree = Uri.parse(preferences.getString("backupUri", ""));
    Uri parent =
        DocumentsContract.buildDocumentUriUsingTree(
            tree, DocumentsContract.getTreeDocumentId(tree));
    String name = filename("json");
    Uri created = null;
    boolean complete = false;
    try {
      created =
          DocumentsContract.createDocument(
              context.getContentResolver(), parent, "application/json", name);
      if (created == null) throw new IOException("文件夹未能创建备份文件");
      write(created, backup().toString(2));
      complete = true;
      long successTime = System.currentTimeMillis();
      boolean hasUiConfig = database.state(SharedUiState.CONFIG) != null;
      database.backupSucceeded(successTime);
      if (hasUiConfig) {
        // SQLite is the canonical settings store in 1.1+. The old preference is only a fallback.
        preferences.edit().putLong("lastBackup", successTime).remove("backupError").apply();
        return name;
      }
      long previousSuccess = preferences.getLong("lastBackup", 0);
      if (!preferences.edit().putLong("lastBackup", successTime).remove("backupError").commit()) {
        preferences.edit().putLong("lastBackup", previousSuccess).apply();
        throw new IOException("备份文件已写入，但成功时间未能保存，请检查存储空间");
      }
      return name;
    } catch (Exception error) {
      // Only remove the new, incomplete file created by this invocation.
      if (created != null && !complete)
        try {
          DocumentsContract.deleteDocument(context.getContentResolver(), created);
        } catch (Exception ignored) {
        }
      throw error;
    }
  }

  public void write(Uri target, String content) throws IOException {
    OutputStream stream = context.getContentResolver().openOutputStream(target, "wt");
    if (stream == null) throw new IOException("无法打开文件写入流");
    try (OutputStream output = stream) {
      output.write(content.getBytes(StandardCharsets.UTF_8));
      output.flush();
    }
    // Success is reported only after close() completes.
  }

  public String read(Uri uri) throws IOException {
    InputStream stream = context.getContentResolver().openInputStream(uri);
    if (stream == null) throw new IOException("无法打开文件");
    try (InputStream input = stream;
        ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
      byte[] chunk = new byte[8192];
      int count;
      while ((count = input.read(chunk)) != -1) {
        if (bytes.size() + count > 20 * 1024 * 1024) throw new IOException("文件超过 20 MB，请拆分导入");
        bytes.write(chunk, 0, count);
      }
      return bytes.toString(StandardCharsets.UTF_8.name());
    }
  }

  public synchronized File snapshot(String reason) throws Exception {
    if (!Arrays.asList("daily", "manual", "import", "preclear").contains(reason))
      throw new IllegalArgumentException("快照类型无效");
    File directory = new File(context.getFilesDir(), "snapshots");
    if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建快照目录");
    File target =
        new File(
            directory,
            System.currentTimeMillis()
                + "-"
                + reason
                + "-"
                + java.util.UUID.randomUUID()
                + ".json");
    AtomicFile atomic = new AtomicFile(target);
    FileOutputStream stream = null;
    byte[] payload = backup().toString(2).getBytes(StandardCharsets.UTF_8);
    try {
      stream = atomic.startWrite();
      stream.write(payload);
      // AtomicFile.finishWrite logs some sync/rename failures instead of throwing.
      // Fail closed before an import or clear if the safety snapshot cannot be verified.
      stream.getFD().sync();
      atomic.finishWrite(stream);
      stream = null;
      if (!Arrays.equals(payload, atomic.readFully())) throw new IOException("快照写入后校验失败，已停止后续操作");
    } catch (Exception e) {
      if (stream != null) atomic.failWrite(stream);
      throw e;
    }
    List<File> list = snapshots();
    for (int i = 10; i < list.size(); i++) if (!list.get(i).delete()) break;
    return target;
  }

  public synchronized List<File> snapshots() {
    File[] list =
        new File(context.getFilesDir(), "snapshots")
            .listFiles((dir, name) -> name.endsWith(".json"));
    if (list == null) return new ArrayList<>();
    Arrays.sort(list, Comparator.comparing(File::getName).reversed());
    return new ArrayList<>(Arrays.asList(list));
  }

  public String readSnapshot(File file) throws IOException {
    File expected = new File(context.getFilesDir(), "snapshots").getCanonicalFile();
    if (!expected.equals(file.getCanonicalFile().getParentFile())) throw new IOException("快照路径无效");
    return new String(new AtomicFile(file).readFully(), StandardCharsets.UTF_8);
  }

  public synchronized void clearSnapshots() throws IOException {
    for (File snapshot : snapshots()) {
      new AtomicFile(snapshot).delete();
      if (snapshot.exists()) throw new IOException("本机快照删除失败");
    }
  }
}
