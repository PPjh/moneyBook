package io.github.ppjh.moneybook;

import static org.junit.Assert.*;

import org.junit.Test;

public class LockPolicyTest {
  @Test
  public void legacyPinCannotSilentlyDisableProtection() {
    assertTrue(LockPolicy.enabled(false, true));
    assertTrue(LockPolicy.enabled(true, false));
    assertFalse(LockPolicy.enabled(false, false));
  }

  @Test
  public void backgroundExpiryHonorsConfiguredDelay() {
    assertFalse(LockPolicy.expired(true, 100, 150, 60));
    assertTrue(LockPolicy.expired(true, 100, 160, 60));
    assertTrue(LockPolicy.expired(true, 100, 100, 0));
    assertFalse(LockPolicy.expired(true, 100, 999999, -1));
    assertFalse(LockPolicy.expired(false, 100, 999999, 0));
    assertFalse(LockPolicy.expired(true, 0, 999999, 0));
  }

  @Test
  public void cancellationAndFailedSamplesNeverAuthorize() {
    assertFalse(LockPolicy.accept(false, 3, 3, false));
  }

  @Test
  public void RendererReloadAndDestroyedActivityRejectStaleSuccess() {
    assertFalse(LockPolicy.accept(true, 2, 3, false));
    assertFalse(LockPolicy.accept(true, 3, 3, true));
    assertTrue(LockPolicy.accept(true, 3, 3, false));
  }

  @Test
  public void nativeAuthenticationActionsAreAllowListed() {
    assertTrue(LockPolicy.validAction("enable"));
    assertTrue(LockPolicy.validAction("disable"));
    assertTrue(LockPolicy.validAction("unlock"));
    assertFalse(LockPolicy.validAction("pinSet"));
    assertFalse(LockPolicy.validAction("forgotPin"));
    assertFalse(LockPolicy.validAction(null));
  }
}
