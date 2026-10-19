package io.github.ppjh.moneybook;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** The PIN is an access screen, not database encryption. No raw PIN is stored or exported. */
public final class PinLock {
  private PinLock() {}

  public static String encode(String pin) throws Exception {
    if (!valid(pin)) throw new IllegalArgumentException("PIN 应为 4 至 6 位数字");
    byte[] salt = new byte[16];
    new SecureRandom().nextBytes(salt);
    return Base64.getEncoder().encodeToString(salt)
        + ":"
        + Base64.getEncoder().encodeToString(derive(pin, salt));
  }

  public static boolean verify(String pin, String encoded) {
    if (!valid(pin) || encoded == null) return false;
    try {
      String[] parts = encoded.split(":");
      if (parts.length != 2) return false;
      return MessageDigest.isEqual(
          Base64.getDecoder().decode(parts[1]), derive(pin, Base64.getDecoder().decode(parts[0])));
    } catch (Exception e) {
      return false;
    }
  }

  public static boolean valid(String pin) {
    return pin != null && pin.matches("[0-9]{4,6}");
  }

  private static byte[] derive(String pin, byte[] salt) throws Exception {
    char[] secret = pin.toCharArray();
    PBEKeySpec spec = new PBEKeySpec(secret, salt, 120_000, 256);
    try {
      return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
    } finally {
      spec.clearPassword();
      Arrays.fill(secret, '\0');
    }
  }
}
