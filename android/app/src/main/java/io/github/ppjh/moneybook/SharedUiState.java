package io.github.ppjh.moneybook;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Strict, testable boundary between the shared UI and the original native database. */
public final class SharedUiState {
  public static final String RECORDS = "jz.records.v1", CONFIG = "jz.config.v1";

  private SharedUiState() {}

  public static List<Ledger.Entry> strictRecords(String text) throws Exception {
    JSONArray rows = new JSONArray(text);
    if (rows.length() > 100_000) throw new IllegalArgumentException("记录超过 100,000 条");
    List<Ledger.Entry> result = new ArrayList<>();
    Set<String> ids = new HashSet<>();
    long total = 0;
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.getJSONObject(i);
      Object amount = row.get("amount");
      if (!(amount instanceof Number)) throw new IllegalArgumentException("金额必须是整数分");
      long cents = new java.math.BigDecimal(amount.toString()).longValueExact();
      String id = row.getString("id");
      if (!ids.add(id)) throw new IllegalArgumentException("记录 ID 重复");
      Ledger.Entry entry =
          new Ledger.Entry(
              id,
              row.getString("type"),
              cents,
              row.optString("cat", "其他"),
              row.optString("note", ""),
              row.getString("date"),
              row.optLong("ts", 0));
      total = Math.addExact(total, cents);
      if (total > 9_007_199_254_740_991L) throw new IllegalArgumentException("账本总金额超出安全范围");
      result.add(entry);
    }
    return result;
  }

  public static JSONObject cleanConfig(JSONObject source) throws Exception {
    String theme = source.optString("theme", "system");
    if (!"light".equals(theme) && !"dark".equals(theme)) theme = "system";
    String cycle = source.optString("autoExport", "weekly");
    if (!"daily".equals(cycle) && !"monthly".equals(cycle) && !"off".equals(cycle))
      cycle = "weekly";
    long delay = source.optLong("lockDelay", 60_000);
    if (delay != 0 && delay != 60_000 && delay != 300_000 && delay != 1_800_000 && delay != -1)
      delay = 60_000;
    JSONObject cats = source.optJSONObject("lastCat"),
        budgets = source.optJSONObject("budgets"),
        validBudgets = new JSONObject();
    if (budgets != null)
      for (java.util.Iterator<String> keys = budgets.keys(); keys.hasNext(); ) {
        String key = keys.next();
        Object raw = budgets.get(key);
        if (!Ledger.validMonth(key) || !(raw instanceof Number)) continue;
        try {
          long value = new java.math.BigDecimal(raw.toString()).longValueExact();
          if (value > 0 && value <= Ledger.MAX_CENTS) validBudgets.put(key, value);
        } catch (ArithmeticException ignored) {
        }
      }
    // PIN material, native biometric flags, directory URIs and arbitrary fields cannot be set by JS.
    return new JSONObject()
        .put("theme", theme)
        .put("autoExport", cycle)
        .put("lockDelay", delay)
        .put("snapOn", source.optBoolean("snapOn", true))
        .put("lastSnap", source.optString("lastSnap", ""))
        .put("lastExport", Math.max(0, source.optLong("lastExport", 0)))
        .put("lastFolderBackup", Math.max(0, source.optLong("lastFolderBackup", 0)))
        .put(
            "backupTarget",
            "download".equals(source.optString("backupTarget")) ? "download" : "folder")
        .put(
            "lastCat",
            new JSONObject()
                .put(
                    "expense",
                    Ledger.truncate(cats == null ? "餐饮" : cats.optString("expense", "餐饮"), 12))
                .put(
                    "income",
                    Ledger.truncate(cats == null ? "工资" : cats.optString("income", "工资"), 12)))
        .put("budgets", validBudgets);
  }

  public static JSONObject publicPin(boolean enabled, int length) throws Exception {
    return enabled
        ? new JSONObject()
            .put("salt", "native")
            .put("hash", "native")
            .put("native", true)
            .put("len", length >= 4 && length <= 6 ? length : 4)
            .put("unknownLength", length < 4 || length > 6)
        : null;
  }
}
