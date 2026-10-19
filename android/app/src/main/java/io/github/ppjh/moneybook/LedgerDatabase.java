package io.github.ppjh.moneybook;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Durable native store. A replacement import and its budgets commit in a single transaction. */
public final class LedgerDatabase extends SQLiteOpenHelper {
  public LedgerDatabase(Context context) {
    super(context, "moneybook.db", null, 2);
    setWriteAheadLoggingEnabled(true);
  }

  @Override
  public void onCreate(SQLiteDatabase db) {
    db.execSQL(
        "CREATE TABLE records (id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL CHECK(type IN"
            + " ('expense','income')), amount INTEGER NOT NULL CHECK(amount>0 AND"
            + " amount<=99999999999), category TEXT NOT NULL, note TEXT NOT NULL, date TEXT NOT"
            + " NULL, timestamp INTEGER NOT NULL)");
    db.execSQL("CREATE INDEX records_by_date ON records(date DESC,timestamp DESC)");
    db.execSQL(
        "CREATE TABLE budgets (month TEXT PRIMARY KEY NOT NULL, amount INTEGER NOT NULL"
            + " CHECK(amount>0 AND amount<=99999999999))");
    createUiState(db);
  }

  @Override
  public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
    if (oldVersion == 1 && newVersion == 2) {
      // Additive migration: keep the original records, budgets, database file and all IDs.
      createUiState(db);
      return;
    }
    throw new IllegalStateException("缺少数据库升级迁移：" + oldVersion + " → " + newVersion);
  }

  private static void createUiState(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE ui_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
  }

  public synchronized String state(String key) {
    try (Cursor c =
        getReadableDatabase()
            .query(
                "ui_state",
                new String[] {"value"},
                "key=?",
                new String[] {key},
                null,
                null,
                null)) {
      return c.moveToFirst() ? c.getString(0) : null;
    }
  }

  public synchronized void state(String key, String value) {
    ContentValues row = new ContentValues();
    row.put("key", key);
    row.put("value", value);
    if (getWritableDatabase()
            .insertWithOnConflict("ui_state", null, row, SQLiteDatabase.CONFLICT_REPLACE)
        == -1) throw new IllegalStateException("本机配置写入失败");
  }

  public synchronized String recordsJson() throws Exception {
    JSONArray rows = new JSONArray();
    for (Ledger.Entry entry : entries()) rows.put(entry.json());
    return rows.toString();
  }

  public synchronized void replaceRecords(String json, String expected) throws Exception {
    java.util.List<Ledger.Entry> rows = SharedUiState.strictRecords(json);
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      if (!recordsJson().equals(expected)) throw new IllegalStateException("账本已更新，请重新加载后再保存");
      db.delete("records", null, null);
      for (Ledger.Entry row : rows) db.insertOrThrow("records", null, values(row));
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }

  public synchronized void configure(JSONObject config) throws Exception {
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      JSONObject clean = SharedUiState.cleanConfig(config);
      db.delete("budgets", null, null);
      JSONObject budgets = clean.getJSONObject("budgets");
      for (java.util.Iterator<String> keys = budgets.keys(); keys.hasNext(); ) {
        String month = keys.next();
        budget(month, budgets.getLong(month));
      }
      state(SharedUiState.CONFIG, clean.toString());
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }

  public synchronized void backupSucceeded(long time) throws Exception {
    String raw = state(SharedUiState.CONFIG);
    if (raw != null) {
      JSONObject config = new JSONObject(raw).put("lastFolderBackup", time).put("lastExport", time);
      state(SharedUiState.CONFIG, config.toString());
    }
  }

  private static ContentValues values(Ledger.Entry r) {
    ContentValues v = new ContentValues();
    v.put("id", r.id);
    v.put("type", r.type);
    v.put("amount", r.amount);
    v.put("category", r.category);
    v.put("note", r.note);
    v.put("date", r.date);
    v.put("timestamp", r.timestamp);
    return v;
  }

  public synchronized void save(Ledger.Entry entry) {
    long result =
        getWritableDatabase()
            .insertWithOnConflict("records", null, values(entry), SQLiteDatabase.CONFLICT_REPLACE);
    if (result == -1) throw new IllegalStateException("账目保存失败");
  }

  public synchronized void restoreDeleted(Ledger.Entry entry) {
    getWritableDatabase().insertOrThrow("records", null, values(entry));
  }

  public synchronized void delete(String id) {
    getWritableDatabase().delete("records", "id=?", new String[] {id});
  }

  public synchronized List<Ledger.Entry> entries() {
    List<Ledger.Entry> out = new ArrayList<>();
    try (Cursor c =
        getReadableDatabase()
            .query("records", null, null, null, null, null, "date DESC,timestamp DESC,id DESC")) {
      while (c.moveToNext())
        out.add(
            new Ledger.Entry(
                c.getString(c.getColumnIndexOrThrow("id")),
                c.getString(c.getColumnIndexOrThrow("type")),
                c.getLong(c.getColumnIndexOrThrow("amount")),
                c.getString(c.getColumnIndexOrThrow("category")),
                c.getString(c.getColumnIndexOrThrow("note")),
                c.getString(c.getColumnIndexOrThrow("date")),
                c.getLong(c.getColumnIndexOrThrow("timestamp"))));
    }
    return out;
  }

  public synchronized Map<String, Long> budgets() {
    Map<String, Long> out = new LinkedHashMap<>();
    try (Cursor c =
        getReadableDatabase()
            .query("budgets", new String[] {"month", "amount"}, null, null, null, null, "month")) {
      while (c.moveToNext()) out.put(c.getString(0), c.getLong(1));
    }
    return out;
  }

  public synchronized void budget(String month, long amount) {
    if (!Ledger.validMonth(month) || amount < 0 || amount > Ledger.MAX_CENTS)
      throw new IllegalArgumentException("预算无效");
    if (amount == 0) getWritableDatabase().delete("budgets", "month=?", new String[] {month});
    else {
      ContentValues v = new ContentValues();
      v.put("month", month);
      v.put("amount", amount);
      if (getWritableDatabase()
              .insertWithOnConflict("budgets", null, v, SQLiteDatabase.CONFLICT_REPLACE)
          == -1) throw new IllegalStateException("预算保存失败");
    }
  }

  public synchronized int importData(Ledger.ImportData data, boolean replace) {
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    int added = 0;
    try {
      if (replace) {
        db.delete("records", null, null);
        db.delete("budgets", null, null);
      }
      for (Ledger.Entry r : data.entries) {
        long result =
            db.insertWithOnConflict(
                "records",
                null,
                values(r),
                replace ? SQLiteDatabase.CONFLICT_ABORT : SQLiteDatabase.CONFLICT_IGNORE);
        if (result != -1) added++;
        else if (replace) throw new IllegalStateException("写入恢复记录失败");
      }
      if (replace)
        for (Map.Entry<String, Long> b : data.budgets.entrySet()) budget(b.getKey(), b.getValue());
      if (replace && state(SharedUiState.CONFIG) != null) {
        try {
          JSONObject config = new JSONObject(state(SharedUiState.CONFIG));
          JSONObject restoredBudgets = new JSONObject();
          for (Map.Entry<String, Long> b : data.budgets.entrySet())
            restoredBudgets.put(b.getKey(), b.getValue());
          state(SharedUiState.CONFIG, config.put("budgets", restoredBudgets).toString());
        } catch (Exception error) {
          throw new IllegalStateException("预算配置写入失败", error);
        }
      }
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
    return added;
  }

  public synchronized void clearLedger() {
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      db.delete("records", null, null);
      db.delete("budgets", null, null);
      db.delete("ui_state", null, null);
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }
}
