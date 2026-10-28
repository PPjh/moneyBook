package io.github.ppjh.moneybook;

import static org.junit.Assert.*;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class LedgerTest {
  private Ledger.Entry entry(String id, String type, long amount, String date, String note) {
    return new Ledger.Entry(id, type, amount, "餐饮", note, date, 1792281600000L);
  }

  @Test
  public void decimalMoneyIsExact() {
    assertEquals(Long.valueOf(30), Ledger.amount("0.1+0.2"));
    assertEquals(Long.valueOf(1), Ledger.amount("0.005"));
    assertEquals("-12.50", Ledger.money(-1250));
  }

  @Test
  public void arithmeticSupportsPrecedenceAndUnicode() {
    assertEquals(Long.valueOf(3090), Ledger.amount("(12.5+2.95)×2"));
    assertEquals(Long.valueOf(500), Ledger.amount("20÷4"));
    assertEquals(Long.valueOf(700), Ledger.amount("1+2*3"));
  }

  @Test
  public void invalidAmountsAreRejected() {
    for (String input :
        Arrays.asList(
            "",
            "0",
            "-1",
            "1/0",
            "1e3",
            "NaN",
            "1;alert(1)",
            "(1+2",
            "1..2",
            "999999999.999",
            "1+")) assertNull(input, Ledger.amount(input));
  }

  @Test
  public void maximumAmountIsCompatibleWithWeb() {
    assertEquals(Long.valueOf(Ledger.MAX_CENTS), Ledger.amount("999999999.99"));
    assertNull(Ledger.amount("1000000000"));
  }

  @Test
  public void realCalendarDatesOnly() {
    assertTrue(Ledger.validDate("2024-02-29"));
    for (String date :
        Arrays.asList("2025-02-29", "2026-13-01", "2026-2-03", "0000-01-01", "2026-04-31"))
      assertFalse(date, Ledger.validDate(date));
  }

  @Test
  public void filterMonthTypeCategoryAndKeyword() {
    List<Ledger.Entry> rows =
        Arrays.asList(
            entry("a", "expense", 1250, "2026-10-18", "午饭"),
            entry("b", "income", 5000, "2026-09-18", "工资"));
    assertEquals(1, Ledger.filter(rows, "2026-10", false, "all", "全部分类", "").size());
    assertEquals(1, Ledger.filter(rows, "2026-10", true, "income", "全部分类", "工资").size());
    assertEquals(0, Ledger.filter(rows, "2026-10", false, "income", "全部分类", "").size());
    assertEquals(1, Ledger.filter(rows, "2026-10", false, "expense", "餐饮", "12.50").size());
  }

  @Test
  public void repairExpenseKeepsItsCategoryInFiltersTotalsAndBackup() throws Exception {
    assertTrue(Arrays.asList(Ledger.EXPENSE).contains("维修"));
    assertFalse(Arrays.asList(Ledger.INCOME).contains("维修"));
    assertEquals(Ledger.EXPENSE.length, Ledger.EXPENSE_EMOJI.length);
    assertEquals("🔧", Ledger.emoji("expense", "维修"));
    Ledger.Entry repair =
        new Ledger.Entry("repair", "expense", 18850, "维修", "修水管", "2026-10-23", 1);
    List<Ledger.Entry> rows =
        Arrays.asList(repair, entry("existing", "expense", 1250, "2026-10-23", "午饭"));
    assertEquals(1, Ledger.filter(rows, "2026-10", false, "expense", "维修", "").size());
    assertEquals(Long.valueOf(18850), Ledger.byCategory(rows).get("维修"));
    Ledger.ImportData parsed =
        Ledger.parse(
            Ledger.backup(rows, Collections.emptyMap(), "light", new JSONObject()).toString());
    assertEquals(2, parsed.entries.size());
    assertEquals(
        18850, Ledger.filter(parsed.entries, "2026-10", false, "all", "维修", "").get(0).amount);
    assertEquals(
        "existing", Ledger.filter(parsed.entries, "2026-10", false, "all", "餐饮", "").get(0).id);
  }

  @Test
  public void amountComparisonsMatchExactCentBoundariesAndKeywords() {
    List<Ledger.Entry> rows = amountSearchRows();
    String[][] cases = {
      {">100", "d,e,f"},
      {">=100", "c,d,e,f"},
      {"<100", "a,b"},
      {"<=100", "a,b,c"},
      {"=100", "c"},
      {"≥100.01", "d,e,f"},
      {"≤0.01", "a"},
      {"大于100", "d,e,f"},
      {"小于100", "a,b"},
      {"大于等于100", "c,d,e,f"},
      {"小于等于100", "a,b,c"},
      {"至少100", "c,d,e,f"},
      {"至多100", "a,b,c"},
      {"不低于100", "c,d,e,f"},
      {"不高于100", "a,b,c"},
      {"> ¥100 元", "d,e,f"},
      {">￥1,000.00", ""},
      {">999.99", "f"},
      {">.01", "b,c,d,e,f"},
      {">100.01", "e,f"},
      {"<0.01", ""},
      {">0", "a,b,c,d,e,f"},
      {">=100 <200", "c,d"},
      {"维修 >100", "d,f"},
      {"维修 >=100 <200", "c,d"},
      {">100 维修", "d,f"},
      {"100.00", "c"},
      {"COFFEE", "b"},
      {"水管 >100", "d"},
      {"收入 >100", "e"},
      {"支出 >100", "d,f"}
    };
    for (String[] item : cases) {
      String ids =
          String.join(
              ",",
              Ledger.filter(rows, "2026-10", true, "all", "全部分类", item[0]).stream()
                  .map(r -> r.id)
                  .sorted()
                  .toArray(String[]::new));
      assertEquals(item[0], item[1], ids);
    }
  }

  @Test
  public void amountSearchCombinesWithMonthTypeCategoryAndMaximum() {
    List<Ledger.Entry> rows = amountSearchRows();
    assertEquals(2, Ledger.filter(rows, "2026-10", false, "all", "全部分类", ">100").size());
    assertEquals(1, Ledger.filter(rows, "2026-10", false, "expense", "全部分类", ">100").size());
    assertEquals(1, Ledger.filter(rows, "2026-10", false, "all", "维修", ">100").size());
    assertEquals("d", Ledger.filter(rows, "2026-10", false, "all", "维修", ">100").get(0).id);
    List<Ledger.Entry> maximum =
        Collections.singletonList(
            new Ledger.Entry("max", "expense", Ledger.MAX_CENTS, "维修", "", "2026-10-28", 1));
    assertEquals(
        1, Ledger.filter(maximum, "2026-10", false, "all", "全部分类", "=999999999.99").size());
    assertEquals(
        0, Ledger.filter(maximum, "2026-10", false, "all", "全部分类", ">999999999.99").size());
  }

  @Test
  public void malformedAmountConditionsNeverExpandResults() {
    for (String text :
        Arrays.asList(
            ">",
            ">=",
            ">-1",
            ">1.001",
            ">1,00",
            ">Infinity",
            ">NaN",
            ">1e2",
            ">100abc",
            ">1000000000",
            ">>100",
            ">=100 <",
            "=100 <200foo",
            ">１００")) {
      assertTrue(
          text, Ledger.filter(amountSearchRows(), "2026-10", true, "all", "全部分类", text).isEmpty());
    }
  }

  private List<Ledger.Entry> amountSearchRows() {
    return Arrays.asList(
        new Ledger.Entry("a", "expense", 1, "维修", "", "2026-10-01", 1),
        new Ledger.Entry("b", "expense", 9999, "餐饮", "Coffee", "2026-10-02", 2),
        new Ledger.Entry("c", "expense", 10000, "维修", "保养", "2026-10-03", 3),
        new Ledger.Entry("d", "expense", 10001, "维修", "水管", "2026-10-04", 4),
        new Ledger.Entry("e", "income", 20000, "工资", "", "2026-10-05", 5),
        new Ledger.Entry("f", "expense", 100000, "维修", "", "2026-09-01", 6));
  }

  @Test
  public void totalsDoNotConfuseIncomeAndExpense() {
    List<Ledger.Entry> rows =
        Arrays.asList(
            entry("a", "expense", 1250, "2026-10-18", ""),
            entry("b", "income", 9000, "2026-10-18", ""));
    assertEquals(1250, Ledger.total(rows, false));
    assertEquals(9000, Ledger.total(rows, true));
    assertEquals(Long.valueOf(1250), Ledger.byCategory(rows).get("餐饮"));
  }

  @Test
  public void nativeExportRoundTripsWebFields() throws Exception {
    Map<String, Long> budgets = new HashMap<>();
    budgets.put("2026-10", 200000L);
    JSONObject json =
        Ledger.backup(
            Collections.singletonList(entry("a", "expense", 1250, "2026-10-18", "演示记录")),
            budgets,
            "dark",
            new JSONObject());
    Ledger.ImportData parsed = Ledger.parse(json.toString());
    assertEquals(1, parsed.entries.size());
    assertEquals("a", parsed.entries.get(0).id);
    assertEquals(1250, parsed.entries.get(0).amount);
    assertEquals(Long.valueOf(200000), parsed.budgets.get("2026-10"));
    assertFalse(json.toString().contains("pin"));
    assertFalse(json.toString().contains("backupUri"));
  }

  @Test
  public void supportsLegacyArraysAndBom() throws Exception {
    String legacy =
        "\uFEFF[{\"date\":\"2026-10-18\",\"amount\":\"1250\",\"type\":\"expense\",\"cat\":\"餐饮\",\"note\":\"演示记录\",\"ts\":1792281600000}]";
    Ledger.ImportData data = Ledger.parse(legacy);
    assertEquals("legacy-1o82z7ce6bglu", data.entries.get(0).id);
  }

  @Test
  public void legacyIdStableWithSlashAndQuotes() throws Exception {
    String id = Ledger.legacyId("2026-10-18", 100, "expense", "其他", "</script>\n\"🍚", 0);
    assertEquals("legacy-fq7kfa11wmchk", id);
  }

  @Test
  public void invalidRowDoesNotConsumeAValidId() throws Exception {
    JSONObject bad = new JSONObject().put("id", "same").put("amount", 1).put("date", "2026-02-30");
    JSONObject good = entry("same", "expense", 100, "2026-10-18", "").json();
    Ledger.ImportData parsed = Ledger.parse(new JSONArray().put(bad).put(good).toString());
    assertEquals(1, parsed.skipped);
    assertEquals("same", parsed.entries.get(0).id);
  }

  @Test
  public void importSkipsBadRowsWithoutLosingGoodRows() throws Exception {
    JSONArray rows = new JSONArray();
    rows.put(entry("a", "expense", 100, "2026-10-18", "").json());
    rows.put(new JSONObject().put("date", "2026-02-30").put("amount", 100));
    rows.put(new JSONObject().put("date", "2026-10-18").put("amount", true));
    rows.put(new JSONObject().put("date", "2026-10-18").put("amount", -20));
    rows.put(new JSONObject().put("date", "2026-10-18").put("amount", 1.5));
    Ledger.ImportData parsed = Ledger.parse(new JSONObject().put("records", rows).toString());
    assertEquals(1, parsed.entries.size());
    assertEquals(4, parsed.skipped);
  }

  @Test
  public void duplicateIdsReceiveStableSuffixes() throws Exception {
    JSONObject row = entry("same", "expense", 100, "2026-10-18", "").json();
    Ledger.ImportData data = Ledger.parse(new JSONArray().put(row).put(row).put(row).toString());
    assertEquals("same", data.entries.get(0).id);
    assertEquals("same-duplicate-1", data.entries.get(1).id);
    assertEquals("same-duplicate-2", data.entries.get(2).id);
  }

  @Test
  public void invalidBudgetsCannotReachDatabase() throws Exception {
    JSONObject budgets =
        new JSONObject()
            .put("2026-10", 2000)
            .put("2026-13", 3)
            .put("2026-11", -1)
            .put("2026-12", "500");
    JSONObject root =
        new JSONObject()
            .put(
                "records", new JSONArray().put(entry("a", "expense", 100, "2026-10-18", "").json()))
            .put("config", new JSONObject().put("budgets", budgets).put("pin", "malicious"));
    Ledger.ImportData data = Ledger.parse(root.toString());
    assertEquals(1, data.budgets.size());
    assertEquals(Long.valueOf(2000), data.budgets.get("2026-10"));
  }

  @Test
  public void emptyImportIsRejected() {
    for (String input : Arrays.asList("{}", "[]", "{\"records\":[]}", "not JSON")) {
      try {
        Ledger.parse(input);
        fail(input);
      } catch (Exception expected) {
      }
    }
  }

  @Test
  public void csvEscapesSpreadsheetFormulasAndQuotes() {
    String csv =
        Ledger.csv(
            Collections.singletonList(entry("a", "expense", 1250, "2026-10-18", "=SUM(1,2)\n\"")));
    assertTrue(csv.startsWith("\uFEFF"));
    assertTrue(csv.contains("12.50"));
    assertTrue(csv.contains("'="));
    assertTrue(csv.contains("\"\""));
  }

  @Test
  public void unicodeTruncationDoesNotSplitEmoji() {
    assertEquals("ab", Ledger.truncate("ab🍚", 3));
    assertEquals("ab🍚", Ledger.truncate("ab🍚", 4));
  }

  @Test
  public void categoriesMatchWeb() {
    assertEquals(20, Ledger.EXPENSE.length);
    assertEquals(7, Ledger.INCOME.length);
    assertEquals("🪙", Ledger.emoji("expense", "token"));
  }

  @Test
  public void pinHashIsSaltedAndDoesNotContainPin() throws Exception {
    String first = PinLock.encode("123456"), second = PinLock.encode("123456");
    assertNotEquals(first, second);
    assertTrue(PinLock.verify("123456", first));
    assertFalse(PinLock.verify("1234", first));
    assertFalse(PinLock.verify("bad", first));
    assertFalse(PinLock.verify("123456", "corrupt"));
  }
}
