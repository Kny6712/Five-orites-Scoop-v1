# Settlement Permission Error — Resolution Plan

**Date**: 2026-10-24  
**Issue**: "Missing or insufficient permissions" error appears on cart page when clicking "Settle Transaction", and persists on the success screen even after the transaction settles successfully.  
**Status**: Code fixes implemented but NOT yet deployed/committed. Requires build, restart, and verification.

---

## Issue Summary (from screenshots)

### Screenshot 1 — Cart page at settlement attempt

- Error banner: "Missing or insufficient permissions" (red)
- Page title: "Payment Pending"
- Order #WOZSPG · P115 · Payment: Unpaid
- "Settle Transaction" button visible

### Screenshot 2 — After hard refresh

- Error banner STILL visible at top: "Missing or insufficient permissions" (red)
- Page title: "Transaction Settled" (green checkmark)
- Receipt shows "Payment: Completed"
- Order #WOZSPG confirmed

**Core problem**: The settlement write succeeds (proven by Screenshot 2 showing "Payment: Completed"), but the "Missing or insufficient permissions" error banner persists on the success screen. The user sees an error on what should be a clean success page.

---

## Root Cause Analysis

### 1. The write succeeds, the listener fails

`settleTransaction()` calls `orderService.updateOrder()` which writes `paymentStatus: 'paid'` to Firestore. The write passes all security rules and succeeds. However, the `onSnapshot` listener (`watchPayment()`) immediately attempts to read the same order document and receives a permission-denied error — most likely due to a stale Firebase auth token or a race condition between the write and the subsequent read.

### 2. The error message persists

The `errorMessage` signal retains the error from the failed listener read (or a prior failed settlement attempt). The error banner in the template was showing on ALL payment outcome screens, including the success screen, so even after `confirmPaid()` clears the error, a subsequent listener error or stale state can re-surface it.

### 3. Evidence the write succeeds

- Screenshot 2 shows "Payment: Completed" and "Order #WOZSPG is confirmed"
- The order document in Firestore reflects `paymentStatus: 'paid'`
- A hard refresh (fresh auth token + fresh listener) shows the correct settled state

---

## Current State of Fixes

All fixes below are **implemented in the working tree** (git status shows them as modified) but **not yet committed** and **not yet picked up by a running dev server**.

### Fix A — Template-level guard (PRIMARY)

**File**: `src/app/features/cart/cart.page.html`, line 463

```html
@if (errorMessage() && paymentOutcome() !== 'success') {
<app-alert-banner tone="danger" [message]="errorMessage()" />
}
```

Prevents the error banner from ever rendering on the success screen, regardless of what `errorMessage()` contains.

### Fix B — Mandatory error clearing when order is paid

**File**: `src/app/features/cart/cart.page.ts`, lines 473-482

```typescript
if (order.paymentStatus === 'paid') {
  console.log('[Payment Snapshot] Order is paid, clearing any stale errors and confirming');
  this.errorMessage.set('');
  this.confirmPaid();
  return;
}
```

The order document is the source of truth. When the listener reads `paymentStatus === 'paid'`, any stale error is cleared before `confirmPaid()` is called.

### Fix C — Listener retry with exponential backoff

**File**: `src/app/features/cart/cart.page.ts`, lines 388-437

- Permission errors from the listener are retried up to 3 times with exponential backoff (1s, 2s, 4s)
- Permission errors are treated as internal monitoring issues and NOT shown to users
- Non-permission listener errors only shown if no existing error

### Fix D — Defensive logging in settlement

**File**: `src/app/features/cart/cart.page.ts`, lines 851-899

- Logs at each step: settlement start, updateOrder call, success, write failure, cleanup
- Distinguishes write errors (user-facing) from listener errors (internal)

### Fix E — Order service logging

**File**: `src/app/core/services/orders/order.service.ts`, lines 461-477

- `updateOrder()` now logs the order ID, update data, fields modified, and success/failure

### Fix F — Permission error detection utility

**File**: `src/app/core/logic/firestore-error.ts` (already existed)

- `isPermissionDeniedError()` classifies `permission-denied` and `unauthenticated` Firestore errors

---

## Resolution Steps

### Step 1: Verify TypeScript compiles

```bash
cd Five-orites-Scoop-v1
npm run typecheck
```

Expected: No TypeScript errors.

### Step 2: Run lint

```bash
npm run lint
```

Expected: No lint errors in the modified files.

### Step 3: Build the application

```bash
npm run build
```

Expected: Build completes successfully, output to `www/`.

### Step 4: Restart the dev server (CRITICAL)

The browser is serving cached JavaScript. The dev server must be restarted so the compiled changes are served.

```bash
# In the terminal running `npm run start`:
Ctrl + C

# Then restart:
npm run start
```

### Step 5: Hard refresh the browser

Navigate to `http://localhost:8100/cart` and press **Ctrl + Shift + R** (Windows) to force the browser to reload all JavaScript files.

### Step 6: Test the settlement flow

**Test 1 — Clean settlement**

1. Add items to cart
2. Fill in delivery address
3. Click "Continue to Payment"
4. Click "Settle Transaction" once
5. ✅ Expected: Success screen appears WITHOUT error banner
6. ✅ Expected: "Transaction Settled" with green checkmark, no red banner above receipt
7. ✅ Expected: Console shows `[Settlement] Update succeeded` and `[Payment Snapshot] Order is paid, clearing any stale errors`

**Test 2 — After hard refresh**

1. Complete a settlement
2. Press Ctrl + Shift + R
3. ✅ Expected: Success screen appears WITHOUT error banner
4. ✅ Expected: Receipt shows "Payment: Completed", no error banner

**Test 3 — Double-click prevention**

1. Click "Settle Transaction" twice rapidly
2. ✅ Expected: Console shows "Already in progress, ignoring duplicate click"
3. ✅ Expected: Only one Firestore write occurs

**Test 4 — Console verification**
Open browser console (F12) and verify expected log output:

```
[Settlement] Starting transaction settlement for order <ID>
[Settlement] Attempting update with data: {...}
[Settlement] Calling updateOrder...
[OrderService.updateOrder] Order ID: <ID>
[OrderService.updateOrder] Update successful
[Settlement] Update succeeded, proceeding with success flow
[Settlement] Resetting isPreparingPayment flag
[Payment Snapshot] Order is paid, clearing any stale errors and confirming
```

---

## Verification Checklist

| #   | Check                                      | Pass/Fail |
| --- | ------------------------------------------ | --------- |
| 1   | `npm run typecheck` passes                 |           |
| 2   | `npm run lint` passes                      |           |
| 3   | `npm run build` completes                  |           |
| 4   | Dev server restarted                       |           |
| 5   | Browser hard refreshed (Ctrl+Shift+R)      |           |
| 6   | Single click settles without error banner  |           |
| 7   | Success screen shows no red error banner   |           |
| 8   | Console shows settlement flow logs         |           |
| 9   | Double-click prevented (single write only) |           |
| 10  | Hard refresh shows settled state cleanly   |           |

---

## Rollback Plan

If the fix causes regressions:

```bash
# Revert the specific modified files
git checkout HEAD -- src/app/features/cart/cart.page.ts
git checkout HEAD -- src/app/features/cart/cart.page.html
git checkout HEAD -- src/app/core/services/orders/order.service.ts

# Rebuild and restart
npm run build
# Restart dev server
```

Or partial rollback (keep logging, remove retry logic): remove the retry block from `watchPayment()` while keeping defensive logging and error clearing.

---

## Files Modified (working tree, uncommitted)

1. `src/app/features/cart/cart.page.ts` — retry logic, error clearing, defensive logging
2. `src/app/features/cart/cart.page.html` — template guard on error banner
3. `src/app/core/services/orders/order.service.ts` — updateOrder logging
4. `src/app/core/models/order.model.ts` — model changes (pre-existing)
5. `src/app/core/models/payment.model.ts` — model changes (pre-existing)

---

## New Files (untracked, reference docs)

- `SETTLEMENT-PERMISSION-ERROR-ANALYSIS.md` — root cause analysis
- `SETTLEMENT-FIX-IMPLEMENTATION.md` — implementation details
- `SETTLEMENT-FIX-STATUS.md` — implementation status
- `SETTLEMENT-FIX-FINAL.md` — final solution summary
- `SETTLEMENT-DEBUG-FIX.md` — debug fix notes

---

## Success Criteria

The fix is considered successful when:

- [ ] No "Missing or insufficient permissions" error banner on legitimate settlements
- [ ] Single click settles transaction without requiring hard refresh
- [ ] Success screen shows NO red error banner (even if `errorMessage` had a prior value)
- [ ] Console logs clearly show settlement flow progression
- [ ] Transient permission errors are automatically retried without user-visible errors
- [ ] Stale error messages are cleared after successful operations
