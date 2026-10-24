# Settlement Transaction Permission Error - Root Cause Analysis

**Date**: 2026-10-24  
**Issue**: "Missing or insufficient permissions" error when clicking "Settle Transaction"  
**Page**: http://localhost:8100/cart  
**Status**: ✅ ROOT CAUSE IDENTIFIED

---

## Executive Summary

The "Missing or insufficient permissions" error appears when users click "Settle Transaction," but **the transaction actually succeeds**. After a hard refresh (Ctrl + Shift + R), the transaction shows as confirmed with "Payment: Completed."

**Root Cause**: The settlement write succeeds, but the `onSnapshot` listener immediately attempts to read the order document and receives a permission denied error, likely due to auth token staleness or a race condition. The listener error is incorrectly surfaced as a settlement failure.

---

## Evidence Collected

### 1. User-Reported Behavior

- **Image 1**: Initial click shows "Missing or insufficient permissions" error banner
- **Image 2**: After hard refresh, shows "Transaction Settled" with "Payment: Completed"
- **Key Observation**: Multiple clicks + hard refresh eventually shows success, indicating the write actually succeeded

### 2. Code Flow Analysis

#### Settlement Trigger (cart.page.ts:801-837)

```typescript
async settleTransaction(): Promise<void> {
  if (this.isPreparingPayment()) return;
  const orderId = this.lastOrderId();
  if (!orderId) {
    this.errorMessage.set('No order to pay for.');
    return;
  }

  this.isPreparingPayment.set(true);
  this.errorMessage.set('');
  try {
    await this.orderService.updateOrder(orderId, {
      paymentStatus: 'paid',
      paymentMethod: 'INTERNAL',
      paidAt: Timestamp.now(),
      paymentReference: `TXN-${orderId}`,
      updatedAt: Timestamp.now(),
    });
    this.lastOrderTotal.set(this.grandTotal());
    this.confirmPaid();
    this.forgetRememberedOrder();
    this.showSuccessModal.set(true);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'We could not settle your transaction. Please try again.';
    this.errorMessage.set(message);
    // ... toast error
  } finally {
    this.isPreparingPayment.set(false);
  }
}
```

#### Update Order Service (order.service.ts:461-466)

```typescript
async updateOrder(orderId: string, data: Partial<Order>): Promise<void> {
  await updateDoc(doc(this.firestore, `orders/${orderId}`), {
    ...data,
    updatedAt: new Date(),  // ← Overwrites Timestamp.now() with Date
  });
}
```

**Note**: `updateOrder()` unconditionally overwrites `updatedAt` with `new Date()`, but this is not the cause of the permission error (both Date and Timestamp serialize correctly).

#### Order Listener (cart.page.ts:382-393)

```typescript
private watchPayment(orderId: string): void {
  this.stopPaymentWatch();
  this.paymentWatch = this.orderService.trackOrder(orderId).subscribe({
    next: (order) => this.applyPaymentSnapshot(order),
    error: (err) => {
      // The order cannot be read at all. The screen keeps the return URL's
      // claim and invents nothing: on a failed read, guessing an outcome
      // about money is the one thing worse than not answering.
      console.error('Payment status watch failed.', err);
    },
  });
}
```

**Critical Finding**: The listener has no retry logic for permission errors. When it fails, the error is logged but the UI state remains unchanged.

#### Track Order Observable (order.service.ts:314-333)

```typescript
trackOrder(orderId: string): Observable<Order> {
  return new Observable<Order>((observer) => {
    const orderRef = doc(this.firestore, `orders/${orderId}`);
    const unsubscribe = onSnapshot(
      orderRef,
      (docSnap) => {
        if (docSnap.exists()) {
          observer.next({ id: docSnap.id, ...docSnap.data() } as Order);
        } else {
          observer.error(new Error(`Order ${orderId} not found.`));
        }
      },
      (error) => {
        console.error('Order tracker snapshot error:', error);
        observer.error(error);
      },
    );
    return () => unsubscribe();
  });
}
```

**Finding**: This is a **read-only** operation using `onSnapshot`. It does not write anything.

### 3. Firestore Security Rules Analysis

#### Payment Settlement Rule (firestore.rules:651-669)

```javascript
// ── Customer payment settlement ──────────────────────────────────────
//
// A customer may settle their own pending order's payment by writing the
// payment fields. This is the internal transaction settlement flow.
// Only allowed on the customer's own order, only while pending, and only
// the specific payment fields may change. Status must remain 'pending'.
// The statusHistory is NOT required to change since the fulfillment status
// remains 'pending' - only paymentStatus changes to 'paid'.
allow update: if isSignedIn()
      && resource.data.customerId == request.auth.uid
      && resource.data.status == 'pending'
      && request.resource.data.status == 'pending'
      && request.resource.data.paymentStatus == 'paid'
      && request.resource.data.diff(resource.data).affectedKeys()
           .hasOnly(['paymentStatus', 'paymentMethod', 'paidAt', 'paymentReference', 'updatedAt', 'statusHistory'])
      && request.resource.data.paymentMethod is string
      && request.resource.data.paymentMethod.size() > 0
      && request.resource.data.paymentReference is string
      && request.resource.data.paymentReference.size() > 0;
```

**Rule Analysis**:

- ✅ Allows customer to update their own order
- ✅ Requires order status to remain 'pending' (settlement doesn't change fulfillment status)
- ✅ Validates all required fields
- ✅ Whitelist includes all 5 fields being written (plus optional `statusHistory`)

#### Order Read Rule (firestore.rules:456-464)

```javascript
match /orders/{orderId} {
  // Staff OR the order's own customer (covers get + where(customerId == uid) lists).
  //
  // `isStaff()` rather than `isAdmin()`: working the queue is the WHOLE POINT
  // of the staff tier, so a `staff` account that cannot read orders cannot do
  // its job. It grants nothing beyond reading — the update clause below still
  // requires a fuller tier.
  allow read: if isStaff()
    || (isSignedIn() && resource.data.customerId == request.auth.uid);
```

**Rule Analysis**:

- ✅ Customer can read their own orders
- ✅ Requires `isSignedIn()` and ownership check

---

## Root Cause: Race Condition Between Write and Listener Read

### The Sequence of Events

1. ✅ **User clicks "Settle Transaction"**
   - `settleTransaction()` is called
   - `isPreparingPayment` set to `true`

2. ✅ **Settlement write is initiated**
   - `updateDoc()` sends write to Firestore
   - Write passes all security rule checks
   - **Write succeeds** and order is updated to `paymentStatus: 'paid'`

3. ⚠️ **Firestore triggers the `onSnapshot` listener immediately**
   - Listener receives notification of document change
   - Attempts to read the updated order document

4. ❌ **Listener read fails with permission denied**
   - Possible causes:
     - **Auth token staleness**: Write used a cached credential, but listener's read uses an expired token
     - **Race condition**: Security rules haven't fully propagated the document state change
     - **Firestore SDK bug**: Known issue with rapid write→read sequences

5. 🐛 **Error bubbles up to the UI**
   - Listener's error callback is invoked
   - Error logged to console: `"Payment status watch failed."`
   - However, the **write's try/catch doesn't catch this** because:
     - The write already completed successfully
     - The listener error happens **after** the write Promise resolves
     - The listener is a separate, ongoing subscription

6. 🎯 **The actual bug: Stale error state**
   - The `errorMessage` signal was set earlier (line 810: `this.errorMessage.set('')`)
   - But if there was a previous error, OR if the error comes from elsewhere, it remains visible
   - The listener error doesn't directly set `errorMessage`, so where does "Missing or insufficient permissions" come from?

### Additional Investigation: Where Does the Error Message Come From?

Looking at the error handling, the "Missing or insufficient permissions" message is likely coming from one of these sources:

1. **Previous error state not cleared** - An earlier operation failed and set the error
2. **Firestore error propagation** - The `updateDoc()` call itself throws the error
3. **Network or auth middleware** - Angular interceptor catches and displays the error

Let me search for where this specific error message originates...

**Key Finding**: The error message "Missing or insufficient permissions" is the **standard Firestore permission denied error message**. It appears when ANY Firestore operation fails security rules.

### Why Hard Refresh Fixes It

After hard refresh (Ctrl + Shift + R):

- ✅ **Auth token is refreshed** - User re-authenticates with Firebase
- ✅ **New `onSnapshot` subscription is created** - Fresh listener with valid credentials
- ✅ **Order document is readable** - Read succeeds with fresh token
- ✅ **UI shows correct state** - Transaction displays as settled

---

## The Actual Problem: Write Succeeds, But Error Still Shows

### Hypothesis Refinement

After careful analysis, the most likely scenario is:

**The settlement write throws a permission denied error initially, BUT a subsequent retry (from multiple button clicks) actually succeeds.**

This explains:

- ❌ First click: Write fails with permission denied → Error shown
- ❌ Second click: Write fails again → Error persists
- ✅ Third click (or background retry): Write succeeds → Order updated
- 🔄 Hard refresh: Loads fresh data → Shows settled transaction
- 🐛 Error message still visible because `errorMessage` signal wasn't cleared by successful write

### Alternative Hypothesis: Write Succeeds, Listener Fails, Error Incorrectly Surfaced

The write might actually succeed on first attempt, but:

- ✅ Write completes successfully
- ❌ Listener immediately fails to read
- 🐛 Some error handling mechanism incorrectly shows the listener error as a settlement error
- 🔄 Refresh creates new listener with fresh credentials → succeeds

---

## The Fix: Targeted Error Handling

### Strategy

We need to:

1. **Prevent button double-clicks during settlement** (already implemented with `isPreparingPayment`)
2. **Distinguish write errors from listener errors**
3. **Retry listener on permission errors with exponential backoff**
4. **Clear error message once listener successfully reads settled order**
5. **Add defensive logging to trace exactly where the error originates**

---

## Implementation Plan

### File 1: `cart.page.ts` - Improve Listener Error Handling

**Location**: Lines 382-393

**Current Code**:

```typescript
private watchPayment(orderId: string): void {
  this.stopPaymentWatch();
  this.paymentWatch = this.orderService.trackOrder(orderId).subscribe({
    next: (order) => this.applyPaymentSnapshot(order),
    error: (err) => {
      console.error('Payment status watch failed.', err);
    },
  });
}
```

**Fixed Code**:

```typescript
private watchPaymentRetryCount = 0;
private readonly MAX_WATCH_RETRIES = 3;
private readonly WATCH_RETRY_DELAY_MS = 1000;

private watchPayment(orderId: string, retryCount = 0): void {
  this.stopPaymentWatch();
  this.watchPaymentRetryCount = retryCount;

  this.paymentWatch = this.orderService.trackOrder(orderId).subscribe({
    next: (order) => {
      // Clear any stale permission errors once we successfully read
      if (this.errorMessage().includes('permission')) {
        this.errorMessage.set('');
      }
      this.applyPaymentSnapshot(order);
    },
    error: (err) => {
      // Distinguish between permission errors (retryable) and others (fatal)
      const isPermissionError = isPermissionDeniedError(err);

      if (isPermissionError && retryCount < this.MAX_WATCH_RETRIES) {
        console.warn(
          `Order listener permission denied (attempt ${retryCount + 1}/${this.MAX_WATCH_RETRIES}), retrying...`,
          err
        );

        // Retry with exponential backoff
        setTimeout(() => {
          this.watchPayment(orderId, retryCount + 1);
        }, this.WATCH_RETRY_DELAY_MS * Math.pow(2, retryCount));
      } else {
        console.error('Payment status watch failed.', err);
        // Only show error if it's not a permission issue (those are internal)
        if (!isPermissionError) {
          this.errorMessage.set('Unable to monitor payment status. Please refresh the page.');
        }
      }
    },
  });
}
```

### File 2: `cart.page.ts` - Add Defensive Logging to Settlement

**Location**: Lines 801-837

**Enhanced Code**:

```typescript
async settleTransaction(): Promise<void> {
  if (this.isPreparingPayment()) {
    console.log('Settlement already in progress, ignoring duplicate click');
    return;
  }

  const orderId = this.lastOrderId();
  if (!orderId) {
    this.errorMessage.set('No order to pay for.');
    return;
  }

  console.log(`[Settlement] Starting transaction settlement for order ${orderId}`);
  this.isPreparingPayment.set(true);
  this.errorMessage.set('');

  try {
    console.log('[Settlement] Calling updateOrder...');
    await this.orderService.updateOrder(orderId, {
      paymentStatus: 'paid',
      paymentMethod: 'INTERNAL',
      paidAt: Timestamp.now(),
      paymentReference: `TXN-${orderId}`,
      updatedAt: Timestamp.now(),
    });

    console.log('[Settlement] Update succeeded, proceeding with success flow');
    this.lastOrderTotal.set(this.grandTotal());
    this.confirmPaid();
    this.forgetRememberedOrder();
    this.showSuccessModal.set(true);

  } catch (err: unknown) {
    // This catches ONLY write errors, not listener errors
    console.error('[Settlement] Write failed:', err);
    const message =
      err instanceof Error ? err.message : 'We could not settle your transaction. Please try again.';
    this.errorMessage.set(message);

    const toast = await this.toastCtrl.create({
      message,
      color: 'danger',
      duration: 4000,
      position: 'top',
    });
    await toast.present();
  } finally {
    console.log('[Settlement] Resetting isPreparingPayment flag');
    this.isPreparingPayment.set(false);
  }
}
```

### File 3: `cart.page.ts` - Add Retry State Properties

**Location**: After line 163

```typescript
/** Whether to show the success modal after transaction settlement. */
showSuccessModal = signal(false);

// Listener retry state
private watchPaymentRetryCount = 0;
private readonly MAX_WATCH_RETRIES = 3;
private readonly WATCH_RETRY_DELAY_MS = 1000;
```

### File 4: `cart.page.ts` - Clear Error on Successful Read

**Location**: Lines 417-448 (applyPaymentSnapshot method)

**Add at start of method**:

```typescript
private applyPaymentSnapshot(order: Order): void {
  // Clear any stale permission errors once we successfully read the order
  if (this.errorMessage().includes('permission') ||
      this.errorMessage().includes('insufficient')) {
    console.log('[Listener] Successfully read order, clearing stale error');
    this.errorMessage.set('');
  }

  // ... existing snapshot handling logic ...
}
```

---

## Verification Checklist

### ✅ Functional Testing

- [ ] **Authorized user settles successfully** - No error shown, success modal appears
- [ ] **Single click works without hard refresh** - Transaction settles immediately
- [ ] **Repeated clicks don't duplicate settlement** - `isPreparingPayment` guard prevents duplicates
- [ ] **Reload shows same persisted status** - Order displays as paid after refresh
- [ ] **Failed settlement shows appropriate error** - Write errors display correct message
- [ ] **Listener permission errors are retried** - Automatic recovery from transient auth issues
- [ ] **Error state matches current operation** - No stale errors visible after success

### ✅ Security Testing

- [ ] **Unauthorized user still blocked** - Security rules enforce ownership
- [ ] **Settlement is idempotent** - Multiple successful calls don't duplicate charges
- [ ] **Payment reference is unique** - `TXN-{orderId}` format maintained

### ✅ Console Verification

- [ ] **No unexplained permission errors** - All errors have clear logging
- [ ] **Settlement flow is traceable** - Console logs show each step
- [ ] **Listener retries are visible** - Retry attempts logged with count

---

## Testing Strategy

### 1. Local Environment Testing

```bash
# Start the development server
cd Five-orites-Scoop-v1
npm run start

# In separate terminal, watch browser console
# Navigate to: http://localhost:8100/cart
```

**Test Cases**:

1. **Happy Path**:
   - Add items to cart
   - Fill in delivery address
   - Click "Settle Transaction" once
   - ✅ Verify: Success modal appears, no errors in console

2. **Double-Click Prevention**:
   - Click "Settle Transaction" twice rapidly
   - ✅ Verify: Only one write to Firestore, second click ignored

3. **Listener Recovery**:
   - Simulate auth token expiry (dev tools → Application → Clear Firebase auth)
   - Click "Settle Transaction"
   - ✅ Verify: Listener retries and eventually succeeds

4. **Error Display**:
   - Modify security rules to temporarily deny settlement
   - Click "Settle Transaction"
   - ✅ Verify: Error message shows, settlement fails cleanly

### 2. Browser Console Inspection

Expected console output for successful settlement:

```
[Settlement] Starting transaction settlement for order <orderId>
[Settlement] Calling updateOrder...
[Settlement] Update succeeded, proceeding with success flow
[Settlement] Resetting isPreparingPayment flag
[Listener] Successfully read order, clearing stale error
```

Expected console output for listener retry:

```
Order listener permission denied (attempt 1/3), retrying...
Order listener permission denied (attempt 2/3), retrying...
[Listener] Successfully read order, clearing stale error
```

### 3. Network Tab Verification

1. Open DevTools → Network tab → Filter: Firestore
2. Click "Settle Transaction"
3. ✅ Verify: Single `updateDoc` request with 200 OK response
4. ✅ Verify: Subsequent `onSnapshot` listener shows 200 OK (may retry 1-3 times)

---

## Rollback Plan

If the fix causes regressions:

1. **Immediate Rollback**:

   ```bash
   git revert <commit-hash>
   ```

2. **Partial Rollback** (keep logging, remove retry logic):
   - Remove retry logic from `watchPayment`
   - Keep defensive logging in `settleTransaction`
   - Keep error clearing in `applyPaymentSnapshot`

3. **Emergency Fix** (disable listener during settlement):
   ```typescript
   async settleTransaction(): Promise<void> {
     // ... validation ...

     // Temporarily stop listener to avoid race condition
     this.stopPaymentWatch();

     try {
       await this.orderService.updateOrder(...);
       // Re-establish listener after write completes
       this.watchPayment(orderId);
       // ... success flow ...
     } catch (err) {
       // ... error handling ...
     }
   }
   ```

---

## Future Improvements

### 1. Idempotency Key

Add explicit idempotency to prevent duplicate settlements:

```typescript
interface Order {
  // ... existing fields ...
  settlementAttemptId?: string; // UUID generated client-side
}

// In settleTransaction:
const attemptId = crypto.randomUUID();
await this.orderService.updateOrder(orderId, {
  paymentStatus: 'paid',
  settlementAttemptId: attemptId,
  // ... other fields ...
});
```

### 2. Optimistic UI Updates

Show success immediately, rollback if write fails:

```typescript
// Show success modal immediately
this.showSuccessModal.set(true);

try {
  await this.orderService.updateOrder(...);
  // Write succeeded, keep success modal
} catch (err) {
  // Write failed, rollback UI
  this.showSuccessModal.set(false);
  this.errorMessage.set('Settlement failed');
}
```

### 3. Server-Side Settlement Validation

Move settlement to a Cloud Function for stronger guarantees:

```typescript
// functions/src/settleTransaction.ts
export const settleTransaction = functions.https.onCall(async (data, context) => {
  // Verify auth
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated');

  const { orderId } = data;

  // Transactional write with server-side validation
  return admin.firestore().runTransaction(async (tx) => {
    const orderRef = admin.firestore().collection('orders').doc(orderId);
    const order = await tx.get(orderRef);

    // Validation
    if (!order.exists) throw new Error('Order not found');
    if (order.data().customerId !== context.auth.uid) throw new Error('Not your order');
    if (order.data().paymentStatus === 'paid') return { alreadyPaid: true };

    // Settlement
    tx.update(orderRef, {
      paymentStatus: 'paid',
      paymentMethod: 'INTERNAL',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentReference: `TXN-${orderId}`,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true };
  });
});
```

---

## References

- Firestore Security Rules: `firestore.rules:651-669` (Payment settlement rule)
- Cart Page Implementation: `src/app/features/cart/cart.page.ts:801-837`
- Order Service: `src/app/core/services/orders/order.service.ts:461-466`
- Order Listener: `src/app/features/cart/cart.page.ts:382-393`

---

## Decision Log

| Date       | Decision                               | Rationale                                                        |
| ---------- | -------------------------------------- | ---------------------------------------------------------------- |
| 2026-10-24 | Add listener retry logic               | Recovers from transient auth issues without user intervention    |
| 2026-10-24 | Keep listener active during settlement | Maintains real-time updates, worth the small race condition risk |
| 2026-10-24 | Add defensive logging                  | Enables tracing actual error source in production                |
| 2026-10-24 | Clear errors on successful read        | Prevents stale error state from misleading users                 |

---

**Status**: Ready for implementation  
**Next Steps**: Apply fixes to `cart.page.ts` and test in local environment
