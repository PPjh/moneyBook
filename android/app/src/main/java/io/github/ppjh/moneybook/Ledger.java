package io.github.ppjh.moneybook;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Platform-independent money, import/export and filtering rules. All amounts are integer cents. */
public final class Ledger {
  private Ledger() {}

  public static final long MAX_CENTS = 99_999_999_999L;
  public static final String[] EXPENSE = {
    "餐饮", "零食", "饮品", "交通", "购物", "居住", "水电", "通讯", "数码", "服饰", "医疗", "娱乐", "学习", "人情", "旅行", "运动",
    "宠物", "token", "其他"
  };
  public static final String[] EXPENSE_EMOJI = {
    "🍚", "🍿", "🥤", "🚌", "🛒", "🏠", "💡", "📱", "💻", "👕", "💊", "🎮", "📚", "🎁", "✈️", "🏃",
    "🐾", "🪙", "📦"
  };
  public static final String[] INCOME = {"工资", "奖金", "红包", "兼职", "理财", "报销", "其他"};
  public static final String[] INCOME_EMOJI = {"💰", "🏆", "🧧", "💼", "📈", "🧾", "📦"};

  public static final class Entry {
    public final String id, type, category, note, date;
    public final long amount, timestamp;

    public Entry(
        String id,
        String type,
        long amount,
        String category,
        String note,
        String date,
        long timestamp) {
      if (id == null
          || id.isEmpty()
          || id.length() > 160
          || !validDate(date)
          || amount <= 0
          || amount > MAX_CENTS
          || !("expense".equals(type) || "income".equals(type)))
        throw new IllegalArgumentException("记录的金额、日期或标识无效");
      this.id = id;
      this.type = type;
      this.amount = amount;
      this.category = truncate(category == null || category.isEmpty() ? "其他" : category, 12);
      this.note = truncate(note == null ? "" : note, 40);
      this.date = date;
      this.timestamp = timestamp;
    }

    public JSONObject json() throws JSONException {
      return new JSONObject()
          .put("id", id)
          .put("type", type)
          .put("amount", amount)
          .put("cat", category)
          .put("note", note)
          .put("date", date)
          .put("ts", timestamp);
    }

    public boolean income() {
      return "income".equals(type);
    }
  }

  public static Entry create(String type, long amount, String category, String note, String date) {
    return new Entry(
        UUID.randomUUID().toString(),
        type,
        amount,
        category,
        note,
        date,
        System.currentTimeMillis());
  }

  public static String truncate(String text, int length) {
    if (text.length() <= length) return text;
    int end = length;
    if (Character.isHighSurrogate(text.charAt(end - 1))) end--;
    return text.substring(0, end);
  }

  public static boolean validDate(String value) {
    try {
      return value != null
          && value.matches("\\d{4}-\\d{2}-\\d{2}")
          && LocalDate.parse(value).getYear() > 0;
    } catch (RuntimeException e) {
      return false;
    }
  }

  public static boolean validMonth(String value) {
    try {
      return value != null
          && value.matches("\\d{4}-\\d{2}")
          && YearMonth.parse(value).getYear() > 0;
    } catch (RuntimeException e) {
      return false;
    }
  }

  public static String money(long cents) {
    return BigDecimal.valueOf(cents, 2).setScale(2, RoundingMode.UNNECESSARY).toPlainString();
  }

  public static String emoji(String type, String category) {
    String[] names = "income".equals(type) ? INCOME : EXPENSE;
    String[] icons = "income".equals(type) ? INCOME_EMOJI : EXPENSE_EMOJI;
    for (int i = 0; i < names.length; i++) if (names[i].equals(category)) return icons[i];
    return "📦";
  }

  public static Long amount(String expression) {
    try {
      BigDecimal value = new Expression(expression).parse();
      long cents = value.movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact();
      return cents > 0 && cents <= MAX_CENTS ? cents : null;
    } catch (RuntimeException e) {
      return null;
    }
  }

  private static final class Expression {
    final String text;
    int at;

    Expression(String input) {
      text =
          input == null
              ? ""
              : input
                  .replaceAll("\\s", "")
                  .replace('×', '*')
                  .replace('÷', '/')
                  .replace('x', '*')
                  .replace('X', '*')
                  .replace('−', '-')
                  .replace('－', '-')
                  .replace('＋', '+');
      if (text.isEmpty() || text.length() > 80) throw new IllegalArgumentException();
    }

    BigDecimal parse() {
      BigDecimal n = sum();
      if (at != text.length()) throw new IllegalArgumentException();
      return n;
    }

    boolean take(char c) {
      if (at < text.length() && text.charAt(at) == c) {
        at++;
        return true;
      }
      return false;
    }

    BigDecimal sum() {
      BigDecimal n = product();
      while (true) {
        if (take('+')) n = n.add(product());
        else if (take('-')) n = n.subtract(product());
        else return n;
      }
    }

    BigDecimal product() {
      BigDecimal n = atom();
      while (true) {
        if (take('*')) n = n.multiply(atom(), MathContext.DECIMAL128);
        else if (take('/')) n = n.divide(atom(), MathContext.DECIMAL128);
        else return n;
      }
    }

    BigDecimal atom() {
      if (take('+')) return atom();
      if (take('-')) return atom().negate();
      if (take('(')) {
        BigDecimal n = sum();
        if (!take(')')) throw new IllegalArgumentException();
        return n;
      }
      int start = at;
      while (at < text.length() && (Character.isDigit(text.charAt(at)) || text.charAt(at) == '.'))
        at++;
      if (start == at) throw new IllegalArgumentException();
      return new BigDecimal(text.substring(start, at));
    }
  }

  public static List<Entry> filter(
      List<Entry> records,
      String month,
      boolean allMonths,
      String type,
      String category,
      String search) {
    List<Entry> out = new ArrayList<>();
    String query = search == null ? "" : search.trim().toLowerCase(Locale.ROOT);
    for (Entry r : records) {
      if (!allMonths && !r.date.startsWith(month)) continue;
      if (!"all".equals(type) && !r.type.equals(type)) continue;
      if (!"全部分类".equals(category) && !r.category.equals(category)) continue;
      if (!query.isEmpty()
          && !(r.category + " " + r.note + " " + r.date + " " + money(r.amount))
              .toLowerCase(Locale.ROOT)
              .contains(query)) continue;
      out.add(r);
    }
    out.sort(
        Comparator.comparing((Entry r) -> r.date).thenComparingLong(r -> r.timestamp).reversed());
    return out;
  }

  public static long total(List<Entry> records, boolean income) {
    long n = 0;
    for (Entry r : records) if (r.income() == income) n = Math.addExact(n, r.amount);
    return n;
  }

  public static Map<String, Long> byCategory(List<Entry> records) {
    Map<String, Long> totals = new LinkedHashMap<>();
    for (Entry r : records)
      if (!r.income()) totals.put(r.category, totals.getOrDefault(r.category, 0L) + r.amount);
    List<Map.Entry<String, Long>> sorted = new ArrayList<>(totals.entrySet());
    sorted.sort(Map.Entry.<String, Long>comparingByValue().reversed());
    Map<String, Long> out = new LinkedHashMap<>();
    for (Map.Entry<String, Long> item : sorted) out.put(item.getKey(), item.getValue());
    return out;
  }

  public static JSONObject backup(
      List<Entry> records, Map<String, Long> budgets, String theme, JSONObject lastCategories)
      throws JSONException {
    JSONArray rows = new JSONArray();
    List<Entry> sorted = new ArrayList<>(records);
    sorted.sort(Comparator.comparing((Entry r) -> r.date).thenComparingLong(r -> r.timestamp));
    for (Entry record : sorted) rows.put(record.json());
    JSONObject budgetObject = new JSONObject();
    for (Map.Entry<String, Long> b : budgets.entrySet()) budgetObject.put(b.getKey(), b.getValue());
    Object range =
        sorted.isEmpty()
            ? JSONObject.NULL
            : new JSONArray().put(sorted.get(0).date).put(sorted.get(sorted.size() - 1).date);
    return new JSONObject()
        .put("app", "轻记账")
        .put("version", 1)
        .put("appVersion", "android-1.0.0")
        .put("exportedAt", java.time.Instant.now().toString())
        .put("count", records.size())
        .put("range", range)
        .put("records", rows)
        .put(
            "config",
            new JSONObject()
                .put("budgets", budgetObject)
                .put("theme", theme)
                .put("lastCat", lastCategories));
  }

  public static final class ImportData {
    public final List<Entry> entries = new ArrayList<>();
    public final Map<String, Long> budgets = new LinkedHashMap<>();
    public int skipped;
  }

  public static ImportData parse(String json) throws JSONException {
    String source = json == null ? "" : json.trim();
    if (source.startsWith("\uFEFF")) source = source.substring(1).trim();
    JSONArray rows;
    JSONObject root = null;
    if (source.startsWith("[")) rows = new JSONArray(source);
    else {
      root = new JSONObject(source);
      rows = root.optJSONArray("records");
    }
    if (rows == null) throw new JSONException("文件里找不到 records 数组");
    if (rows.length() > 100_000) throw new JSONException("记录超过 100,000 条，请拆分导入");
    ImportData data = new ImportData();
    Set<String> seen = new HashSet<>();
    for (int i = 0; i < rows.length(); i++) {
      try {
        JSONObject row = rows.getJSONObject(i);
        Object raw = row.get("amount");
        if (!(raw instanceof Number) && !(raw instanceof String))
          throw new IllegalArgumentException();
        long cents = new BigDecimal(raw.toString().trim()).longValueExact();
        String type = "income".equals(row.optString("type")) ? "income" : "expense";
        String date = row.optString("date", "");
        if (cents <= 0 || cents > MAX_CENTS || !validDate(date))
          throw new IllegalArgumentException();
        String category = truncate(row.optString("cat", "其他"), 12);
        if (category.isEmpty()) category = "其他";
        String note = truncate(row.optString("note", ""), 40);
        long time = row.optLong("ts", 0);
        String base = row.optString("id", "");
        if (base.isEmpty() || "null".equals(base))
          base = legacyId(date, cents, type, category, note, time);
        else base = truncate(base, 120);
        String id = base;
        int suffix = 1;
        while (!seen.add(id)) id = base + "-duplicate-" + suffix++;
        data.entries.add(new Entry(id, type, cents, category, note, date, time));
      } catch (Exception invalid) {
        data.skipped++;
      }
    }
    JSONObject config = root == null ? null : root.optJSONObject("config");
    JSONObject budgets = config == null ? null : config.optJSONObject("budgets");
    if (budgets != null) {
      for (java.util.Iterator<String> keys = budgets.keys(); keys.hasNext(); ) {
        String key = keys.next();
        try {
          Object raw = budgets.get(key);
          if (!(raw instanceof Number)) continue;
          long value = new BigDecimal(raw.toString()).longValueExact();
          if (validMonth(key) && value > 0 && value <= MAX_CENTS) data.budgets.put(key, value);
        } catch (Exception ignored) {
          /* bad budget is not an account record */
        }
      }
    }
    if (data.entries.isEmpty()) throw new JSONException("文件里没有可用的记录（跳过 " + data.skipped + " 条）");
    return data;
  }

  /** Same UTF-16 FNV/DJB2 ID as the Web importer, for stable legacy merges across clients. */
  static String legacyId(
      String date, long amount, String type, String category, String note, long time) {
    String source =
        "["
            + jsQuote(date)
            + ","
            + amount
            + ","
            + jsQuote(type)
            + ","
            + jsQuote(category)
            + ","
            + jsQuote(note)
            + ","
            + time
            + "]";
    int a = (int) 2166136261L, b = 5381;
    for (int i = 0; i < source.length(); i++) {
      a = (a ^ source.charAt(i)) * 16777619;
      b = (b * 33) ^ source.charAt(i);
    }
    return "legacy-"
        + Long.toString(Integer.toUnsignedLong(a), 36)
        + Long.toString(Integer.toUnsignedLong(b), 36);
  }

  private static String jsQuote(String text) {
    StringBuilder out = new StringBuilder("\"");
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      switch (c) {
        case '"':
          out.append("\\\"");
          break;
        case '\\':
          out.append("\\\\");
          break;
        case '\b':
          out.append("\\b");
          break;
        case '\f':
          out.append("\\f");
          break;
        case '\n':
          out.append("\\n");
          break;
        case '\r':
          out.append("\\r");
          break;
        case '\t':
          out.append("\\t");
          break;
        default:
          boolean unpaired =
              Character.isHighSurrogate(c)
                  ? i + 1 >= text.length() || !Character.isLowSurrogate(text.charAt(i + 1))
                  : Character.isLowSurrogate(c)
                      && (i == 0 || !Character.isHighSurrogate(text.charAt(i - 1)));
          if (c < 32 || unpaired) out.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
          else out.append(c);
      }
    }
    return out.append('"').toString();
  }

  public static String csv(List<Entry> records) {
    StringBuilder out = new StringBuilder("\uFEFF日期,类型,分类,金额(元),备注\r\n");
    for (Entry r : records)
      out.append(cell(r.date))
          .append(',')
          .append(r.income() ? "收入" : "支出")
          .append(',')
          .append(cell(r.category))
          .append(',')
          .append(money(r.amount))
          .append(',')
          .append(cell(r.note))
          .append("\r\n");
    return out.toString();
  }

  static String cell(String input) {
    String s = input;
    if (s.matches("(?s)^\\s*[=+\\-@\\t\\r].*")) s = "'" + s;
    return s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r")
        ? "\"" + s.replace("\"", "\"\"") + "\""
        : s;
  }
}
