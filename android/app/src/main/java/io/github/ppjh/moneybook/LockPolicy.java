package io.github.ppjh.moneybook;

/** Pure policy shared by native lifecycle checks and JVM regression tests. */
public final class LockPolicy {
  private LockPolicy() {}

  public static boolean enabled(boolean biometric, boolean legacyPin) {
    return biometric || legacyPin;
  }

  public static boolean expired(boolean enabled, long leftAt, long now, long delay) {
    return enabled && leftAt > 0 && delay >= 0 && now - leftAt >= delay;
  }

  public static boolean accept(
      boolean success, int attemptPage, int currentPage, boolean destroyed) {
    return success && attemptPage == currentPage && !destroyed;
  }

  public static boolean validAction(String action) {
    return "enable".equals(action) || "disable".equals(action) || "unlock".equals(action);
  }
}
