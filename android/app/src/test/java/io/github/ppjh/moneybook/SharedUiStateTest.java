package io.github.ppjh.moneybook;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class SharedUiStateTest {
  private JSONObject row() throws Exception {
    return new JSONObject()
        .put("id", "original-native-id")
        .put("type", "expense")
        .put("amount", 1250)
        .put("cat", "餐饮")
        .put("note", "原有账目🍚")
        .put("date", "2026-10-18")
        .put("ts", 1792281600000L);
  }

  @Test
  public void strictStoragePreservesExistingNativeFields() throws Exception {
    Ledger.Entry entry = SharedUiState.strictRecords(new JSONArray().put(row()).toString()).get(0);
    assertEquals("original-native-id", entry.id);
    assertEquals(1250, entry.amount);
    assertEquals("原有账目🍚", entry.note);
    assertEquals(1792281600000L, entry.timestamp);
  }

  @Test
  public void emptyStorageWriteIsSupportedForExplicitClear() throws Exception {
    assertTrue(SharedUiState.strictRecords("[]").isEmpty());
  }

  @Test
  public void invalidWritesFailInsteadOfSilentlyDroppingRows() throws Exception {
    for (JSONObject bad :
        new JSONObject[] {
          row().put("amount", 1.2),
          row().put("amount", "1250"),
          row().put("date", "2026-02-30"),
          row().put("type", "unknown")
        }) {
      try {
        SharedUiState.strictRecords(
            new JSONArray().put(row()).put(bad.put("id", "bad")).toString());
        fail();
      } catch (RuntimeException expected) {
      }
    }
  }

  @Test
  public void duplicateIdsCannotReplaceTheOriginalRecord() throws Exception {
    try {
      SharedUiState.strictRecords(new JSONArray().put(row()).put(row()).toString());
      fail();
    } catch (IllegalArgumentException expected) {
    }
  }

  @Test
  public void configurationNeverStoresPinOrDirectoryCredentials() throws Exception {
    JSONObject clean =
        SharedUiState.cleanConfig(
            new JSONObject()
                .put("pin", "secret")
                .put("biometric", new JSONObject().put("enabled", false))
                .put("biometricEnabled", false)
                .put("backupUri", "private-uri")
                .put("theme", "dark")
                .put("lockDelay", 300_000)
                .put("lastCat", new JSONObject().put("expense", "交通")));
    assertFalse(clean.has("pin"));
    assertFalse(clean.has("biometric"));
    assertFalse(clean.has("biometricEnabled"));
    assertFalse(clean.has("backupUri"));
    assertEquals("dark", clean.getString("theme"));
    assertEquals(300_000, clean.getLong("lockDelay"));
    assertEquals("交通", clean.getJSONObject("lastCat").getString("expense"));
  }

  @Test
  public void configurationValidatesBudgetsAndPreferences() throws Exception {
    JSONObject clean =
        SharedUiState.cleanConfig(
            new JSONObject()
                .put("theme", "bad")
                .put("lockDelay", 5)
                .put("autoExport", "bad")
                .put(
                    "budgets",
                    new JSONObject()
                        .put("2026-10", 200000)
                        .put("2026-11", -1)
                        .put("2026-13", 100)
                        .put("2026-12", 1.5)));
    assertEquals("system", clean.getString("theme"));
    assertEquals(60_000, clean.getLong("lockDelay"));
    assertEquals("weekly", clean.getString("autoExport"));
    assertEquals(1, clean.getJSONObject("budgets").length());
    assertEquals(200000, clean.getJSONObject("budgets").getLong("2026-10"));
  }

  @Test
  public void legacyPinRemainsNativeWithoutGuessingItsLength() throws Exception {
    JSONObject unknown = SharedUiState.publicPin(true, 0);
    assertTrue(unknown.getBoolean("native"));
    assertTrue(unknown.getBoolean("unknownLength"));
    assertEquals("native", unknown.getString("hash"));
    JSONObject known = SharedUiState.publicPin(true, 6);
    assertFalse(known.getBoolean("unknownLength"));
    assertEquals(6, known.getInt("len"));
    assertNull(SharedUiState.publicPin(false, 0));
  }
}
