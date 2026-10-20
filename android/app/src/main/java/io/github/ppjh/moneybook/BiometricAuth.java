package io.github.ppjh.moneybook;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.Intent;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.fingerprint.FingerprintManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import org.json.JSONObject;

/** System-owned authentication only. Never receives fingerprint data or a device credential. */
@SuppressWarnings("deprecation")
public final class BiometricAuth {
  private static final int CREDENTIAL = 601;

  public interface Callback {
    void done(boolean success, String message);
  }

  private final Activity activity;
  private final Handler main = new Handler(Looper.getMainLooper());
  private CancellationSignal signal;
  private AlertDialog legacyDialog;
  private Callback callback;
  private int generation;
  private boolean credentialPending;

  public BiometricAuth(Activity activity) {
    this.activity = activity;
  }

  public boolean busy() {
    return callback != null;
  }

  public boolean waitingForCredential() {
    return credentialPending;
  }

  public boolean deviceSecure() {
    try {
      KeyguardManager manager = activity.getSystemService(KeyguardManager.class);
      return manager != null && manager.isDeviceSecure();
    } catch (RuntimeException error) {
      return false;
    }
  }

  public boolean available() {
    try {
      if (!deviceSecure()) return false;
      if (Build.VERSION.SDK_INT >= 30) {
        BiometricManager manager = activity.getSystemService(BiometricManager.class);
        return manager != null
            && manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                == BiometricManager.BIOMETRIC_SUCCESS;
      }
      FingerprintManager manager = activity.getSystemService(FingerprintManager.class);
      return manager != null && manager.isHardwareDetected() && manager.hasEnrolledFingerprints();
    } catch (RuntimeException error) {
      return false;
    }
  }

  public JSONObject info(boolean enabled, boolean migrating) throws Exception {
    boolean enrolled = available(), secure = deviceSecure();
    return new JSONObject()
        .put("enabled", enabled)
        .put("migrating", migrating)
        .put("available", enrolled)
        .put("deviceCredential", secure)
        .put(
            "description",
            enrolled
                ? "使用系统已录入的指纹／生物识别；可用手机锁屏密码备用"
                : secure ? "请在系统设置中录入指纹；已开启的保护可用手机锁屏密码验证" : "请先在手机系统设置中设置锁屏并录入指纹");
  }

  public void authenticate(String title, boolean credentialOnly, Callback result) {
    if (busy()) {
      result.done(false, "请先完成当前系统验证");
      return;
    }
    callback = result;
    int token = ++generation;
    try {
      if (credentialOnly || !available()) {
        credential(token);
        return;
      }
      signal = new CancellationSignal();
      if (Build.VERSION.SDK_INT >= 30) {
        new BiometricPrompt.Builder(activity)
            .setTitle(title)
            .setSubtitle("请使用手机已录入的指纹／生物识别验证")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButton(
                "使用手机锁屏密码", activity.getMainExecutor(), (dialog, which) -> credential(token))
            .build()
            .authenticate(
                signal,
                activity.getMainExecutor(),
                new BiometricPrompt.AuthenticationCallback() {
                  @Override
                  public void onAuthenticationSucceeded(
                      BiometricPrompt.AuthenticationResult result) {
                    finish(token, true, "");
                  }

                  @Override
                  public void onAuthenticationError(int code, CharSequence message) {
                    finish(token, false, message.toString());
                  }
                  // A rejected sample is not a successful or terminal authentication.
                });
      } else {
        FingerprintManager manager = activity.getSystemService(FingerprintManager.class);
        legacyDialog =
            new AlertDialog.Builder(activity)
                .setTitle(title)
                .setMessage("请触摸手机指纹传感器")
                .setNegativeButton("取消", (dialog, which) -> finish(token, false, "已取消验证"))
                .setNeutralButton("使用手机锁屏密码", (dialog, which) -> credential(token))
                .setOnCancelListener(dialog -> finish(token, false, "已取消验证"))
                .create();
        legacyDialog.show();
        manager.authenticate(
            null,
            signal,
            0,
            new FingerprintManager.AuthenticationCallback() {
              @Override
              public void onAuthenticationSucceeded(
                  FingerprintManager.AuthenticationResult result) {
                finish(token, true, "");
              }

              @Override
              public void onAuthenticationFailed() {
                if (token == generation && legacyDialog != null)
                  legacyDialog.setMessage("未识别，请再次触摸指纹传感器");
              }

              @Override
              public void onAuthenticationError(int code, CharSequence message) {
                finish(token, false, message.toString());
              }
            },
            main);
      }
    } catch (RuntimeException error) {
      finish(token, false, "无法启动系统验证，请使用手机锁屏密码或检查系统指纹设置");
    }
  }

  private void credential(int token) {
    if (token != generation || callback == null) return;
    // Invalidate sensor callbacks before switching to the system credential activity.
    int next = ++generation;
    if (signal != null) {
      signal.cancel();
      signal = null;
    }
    if (legacyDialog != null) {
      legacyDialog.dismiss();
      legacyDialog = null;
    }
    if (!deviceSecure()) {
      finish(next, false, "请先在手机系统设置中设置锁屏并录入指纹，本机账目仍保留");
      return;
    }
    try {
      KeyguardManager manager = activity.getSystemService(KeyguardManager.class);
      Intent intent = manager.createConfirmDeviceCredentialIntent("验证手机锁屏", "验证后继续使用轻记账；不是原应用 PIN");
      if (intent == null) {
        finish(next, false, "当前系统无法验证锁屏密码，请检查系统安全设置");
        return;
      }
      credentialPending = true;
      activity.startActivityForResult(intent, CREDENTIAL);
    } catch (RuntimeException error) {
      credentialPending = false;
      finish(next, false, "无法启动手机锁屏验证");
    }
  }

  public boolean activityResult(int code, int result) {
    if (code != CREDENTIAL) return false;
    if (credentialPending && callback != null) {
      credentialPending = false;
      finish(generation, result == Activity.RESULT_OK, result == Activity.RESULT_OK ? "" : "已取消验证");
    }
    return true;
  }

  private void finish(int token, boolean success, String message) {
    if (token != generation || callback == null) return;
    Callback result = callback;
    callback = null;
    credentialPending = false;
    ++generation;
    if (signal != null) {
      signal.cancel();
      signal = null;
    }
    if (legacyDialog != null) {
      legacyDialog.dismiss();
      legacyDialog = null;
    }
    result.done(success, message);
  }

  public void cancel() {
    if (callback != null) finish(generation, false, "验证已中止，请重试");
  }

  public void settings() {
    Intent intent;
    if (Build.VERSION.SDK_INT >= 30)
      intent =
          new Intent(Settings.ACTION_BIOMETRIC_ENROLL)
              .putExtra(
                  Settings.EXTRA_BIOMETRIC_AUTHENTICATORS_ALLOWED,
                  BiometricManager.Authenticators.BIOMETRIC_STRONG);
    else intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
    try {
      activity.startActivity(intent);
    } catch (RuntimeException error) {
      activity.startActivity(new Intent(Settings.ACTION_SETTINGS));
    }
  }
}
