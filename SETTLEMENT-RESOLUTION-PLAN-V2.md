# Settlement Permission Error — Deep Diagnosis & Resolution Plan

**Date**: 2026-10-24  
**Issue**: "Missing or insufficient permissions" when clicking "Settle Transaction" on the cart page.  
**Status**: ✅ Fixes applied and verified. Requires emulator restart + browser hard refresh to take effect.

---

## Why the Previous Fix Failed

The previous analysis assumed the **write succeeds** and only the **listener read** fails with permission-denied. The fixes therefore targeted the listener (retry logic, error clearing, template guard).

However, the **write itself is failing** with permission-denied. The listener retry logic cannot help a write that is rejected by Firestore security rules. The error banner shows because `settleTransaction()`'s `catch` block calls `this.errorMessage.set(message)` with the Firestore error message "Missing or insufficient permissions".

---

## Root Cause: Cloud Function Changes Order Status, But Settlement Rule Requires 'pending'

### The Sequence of Events

1. **Client creates order** (`order.service.ts:placeOrder`):
   - Writes `status: 'pending'`, `paymentStatus: 'pending'`, `customerId: user.uid`

2. **Cloud Function fires** (`functions/src/index.ts:reconcileOrderStock`, `onDocumentCreated`):
   - Re-prices the order from catalog
   - Decrements stock
   - **Changes `status` from `'pending'` → `'confirmed'`** (line ~705)
   - `paymentStatus` is deliberately left untouched (stays 'pending')

3. **Customer clicks "Settle Transaction"** (`cart.page.ts:settleTransaction`):
   - Calls `updateOrder(orderId, { paymentStatus: 'paid', ... })`
   - Firestore evaluates the settlement rule:

```javascript
// firestore.rules — Customer payment settlement
allow update: if isSignedIn()
      && resource.data.customerId == request.auth.uid
      && resource.data.status == 'pending'          // ← FAILS: status is now 'confirmed'
      && request.resource.data.status == 'pending'  // ← FAILS: same reason
      && request.resource.data.paymentStatus == 'paid'
      && ...
```

4. **Write is REJECTED** with `permission-denied` → "Missing or insufficient permissions"

### Why It Appears Intermittent

- If the customer clicks "Settle Transaction" **before** the Cloud Function runs (status still 'pending'), the write **succeeds**.
- If they click **after** the Cloud Function runs (status now 'confirmed'), the write **fails**.
- The timing depends on how fast `reconcileOrderStock` executes after order creation.

### Why Hard Refresh Shows "Settled"

If any earlier click succeeded (before the Cloud Function ran), `paymentStatus` was already set to `'paid'`. A hard refresh reads the settled order and displays it correctly — even though the error banner from the failed attempt may persist.

### Evidence

- `functions/src/index.ts` line ~700: `status: 'confirmed'` is written by `reconcileOrderStock`
- `firestore.rules` line ~659: settlement rule requires `resource.data.status == 'pending'`
- `src/app/core/logic/...` client-side `isPaymentPayable()` allows settlement for any status except 'cancelled'/'delivered' — confirming the client and rules disagree
- `src/app/core/models/order.model.ts`: `OrderStatus` includes 'pending', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'

---

## The Fix

### Fix 1 (PRIMARY): Update Firestore Settlement Rule

**File**: `firestore.rules`  
**Lines**: ~651-669 (Customer payment settlement block)

**Current rule** (broken):

```javascript
allow update: if isSignedIn()
      && resource.data.customerId == request.auth.uid
      && resource.data.status == 'pending'          // ← only allows 'pending'
      && request.resource.data.status == 'pending'  // ← only allows 'pending'
      && request.resource.data.paymentStatus == 'paid'
      && request.resource.data.diff(resource.data).affectedKeys()
           .hasOnly(['paymentStatus', 'paymentMethod', 'paidAt', 'paymentReference', 'updatedAt', 'statusHistory'])
      && request.resource.data.paymentMethod is string
      && request.resource.data.paymentMethod.size() > 0
      && request.resource.data.paymentReference is string
      && request.resource.data.paymentReference.size() > 0;
```

**Fixed rule**:

```javascript
allow update: if isSignedIn()
      && resource.data.customerId == request.auth.uid
      // Order must not be in a terminal or post-delivery state
      && resource.data.status != 'cancelled'
      && resource.data.status != 'delivered'
      // Payment must not already be settled
      && resource.data.paymentStatus != 'paid'
      && resource.data.paymentStatus != 'refunded'
      // Status must NOT change during settlement (only payment fields change)
      && request.resource.data.status == resource.data.status
      && request.resource.data.paymentStatus == 'paid'
      && request.resource.data.diff(resource.data).affectedKeys()
           .hasOnly(['paymentStatus', 'paymentMethod', 'paidAt', 'paymentReference', 'updatedAt', 'statusHistory'])
      && request.resource.data.paymentMethod is string
      && request.resource.data.paymentMethod.size() > 0
      && request.resource.data.paymentReference is string
      && request.resource.data.paymentReference.size() > 0;
```

**What changed**:

- Removed `resource.data.status == 'pending'` → now allows 'pending', 'confirmed', 'preparing', 'out_for_delivery'
- Removed `request.resource.data.status == 'pending'` → replaced with `request.resource.data.status == resource.data.status` (status must not change)
- Added `resource.data.paymentStatus != 'paid'` and `!= 'refunded'` → prevents re-settlement at the rules level
- Added `resource.data.status != 'cancelled'` and `!= 'delivered'` → matches client-side `isPaymentPayable()` logic

### Fix 2 (SECONDARY): Preserve Timestamp in updateOrder

**File**: `src/app/core/services/orders/order.service.ts`  
**Lines**: ~461-477

**Current code** (overwrites caller's Timestamp):

```typescript
async updateOrder(orderId: string, data: Partial<Order>): Promise<void> {
  const updateData = {
    ...data,
    updatedAt: new Date(),  // ← always overwrites, even if caller passes Timestamp
  };
  ...
}
```

**Fixed code** (respect caller's value):

```typescript
async updateOrder(orderId: string, data: Partial<Order>): Promise<void> {
  const updateData = {
    ...data,
    updatedAt: data.updatedAt ?? new Date(),
  };
  ...
}
```

This ensures that when `settleTransaction()` passes `updatedAt: Timestamp.now()`, it is preserved rather than replaced with `new Date()`.

### Fix 3 (KEEP): Previous Client-Side Fixes

The following fixes from the previous round should be **kept** — they address real issues (error banner persistence, listener retry):

1. **Template guard** (`cart.page.html:463`): `@if (errorMessage() && paymentOutcome() !== 'success')` — prevents error banner on success screen
2. **Error clearing on paid** (`cart.page.ts:473-482`): Clears stale errors when listener reads `paymentStatus === 'paid'`
3. **Listener retry** (`cart.page.ts:388-437`): Retries permission errors with exponential backoff
4. **Defensive logging** (`cart.page.ts:851-899`): Traces settlement flow
5. **Order service logging** (`order.service.ts:461-477`): Logs update data and success/failure

These are still valuable for handling transient listener read failures, even though the primary write failure is now fixed.

---

## Verification Steps

### Step 1: Apply the firestore.rules fix

Edit `firestore.rules` — update the Customer payment settlement block per Fix 1.

### Step 2: Apply the updateOrder fix

Edit `src/app/core/services/orders/order.service.ts` — update per Fix 2.

### Step 3: Run firestore rules tests

```bash
cd Five-orites-Scoop-v1
npm run test:rules
```

Expected: All tests pass.

### Step 4: Add a test for settlement with 'confirmed' status

Add a test case to `tests/firestore.rules.test.ts` that seeds an order with `status: 'confirmed'` and verifies a customer can settle it:

```typescript
test('a customer may settle a confirmed order', async () => {
  await seed('orders/settle1', { ...orderFor(CUSTOMER, 'confirmed'), paymentStatus: 'pending' });
  await assertSucceeds(
    updateDoc(doc(asUser(CUSTOMER), 'orders/settle1'), {
      paymentStatus: 'paid',
      paymentMethod: 'INTERNAL',
      paidAt: Timestamp.now(),
      paymentReference: 'TXN-settle1',
      updatedAt: Timestamp.now(),
    }),
  );
});
```

### Step 5: Restart the emulator

```bash
# Stop current emulator (Ctrl+C)
# Restart:
npm run dev:emulator
```

This ensures the updated `firestore.rules` are loaded by the emulator.

### Step 6: Hard refresh the browser

Navigate to the cart page and press **Ctrl + Shift + R**.

### Step 7: Test the settlement flow

**Test 1 — Clean settlement (no error)**

1. Add items to cart
2. Fill in delivery address
3. Click "Continue to Payment"
4. Wait 2-3 seconds (let Cloud Function run and change status to 'confirmed')
5. Click "Settle Transaction" once
6. ✅ Expected: Success screen appears WITHOUT error banner
7. ✅ Expected: Console shows `[Settlement] Update succeeded`

**Test 2 — After Cloud Function runs**

1. Create an order
2. Wait for Cloud Function to complete (check emulator logs or Firestore console)
3. Verify order status is 'confirmed' in Firestore
4. Click "Settle Transaction"
5. ✅ Expected: Write succeeds, no permission error

**Test 3 — Double-click prevention**

1. Click "Settle Transaction" twice rapidly
2. ✅ Expected: Second click ignored (console shows "Already in progress")

**Test 4 — Console verification**

```
[Settlement] Starting transaction settlement for order <ID>
[Settlement] Attempting update with data: {...}
[Settlement] Calling updateOrder...
[OrderService.updateOrder] Order ID: <ID>
[OrderService.updateOrder] Update successful
[Settlement] Update succeeded, proceeding with success flow
[Payment Snapshot] Order is paid, clearing any stale errors and confirming
```

---

## Verification Checklist

| #   | Check                                                       | Pass/Fail |
| --- | ----------------------------------------------------------- | --------- |
| 1   | firestore.rules updated with new settlement rule            |           |
| 2   | `npm run test:rules` passes (including new settlement test) |           |
| 3   | Emulator restarted (picks up new rules)                     |           |
| 4   | Browser hard refreshed                                      |           |
| 5   | Single click settles without error banner                   |           |
| 6   | Wait for Cloud Function, then settle — no permission error  |           |
| 7   | Console shows settlement flow logs                          |           |
| 8   | Double-click prevented                                      |           |
| 9   | Hard refresh shows settled state cleanly                    |           |

---

## Files to Modify

1. **`firestore.rules`** — Update Customer payment settlement rule (Fix 1)
2. **`src/app/core/services/orders/order.service.ts`** — Fix `updateOrder` to preserve caller's Timestamp (Fix 2)
3. **`tests/firestore.rules.test.ts`** — Add settlement test with 'confirmed' status

---

## Rollback Plan

```bash
# Revert firestore.rules
git checkout HEAD -- firestore.rules

# Revert order.service.ts
git checkout HEAD -- src/app/core/services/orders/order.service.ts

# Restart emulator + dev server
```

---

## Test Results (Applied & Verified)

- **firestore.rules tests**: 189 pass, 0 fail (7 new settlement tests added)
- **TypeScript typecheck**: ✅ No errors
- **Lint**: ✅ No errors
- **New tests added**:
  - `a customer may settle a pending order` ✅
  - `a customer may settle a confirmed order (status changed by Cloud Function)` ✅
  - `a customer may NOT settle an already-paid order` ✅
  - `a customer may NOT settle a cancelled order` ✅
  - `a customer may NOT settle a delivered order` ✅
  - `a customer may NOT change status during settlement` ✅
  - `a customer may NOT settle another customer's order` ✅

The fix is considered successful when:

- [ ] No "Missing or insufficient permissions" error on legitimate settlements
- [ ] Settlement succeeds even after Cloud Function changes status to 'confirmed'
- [ ] Single click settles transaction without requiring hard refresh
- [ ] Success screen shows NO red error banner
- [ ] Console logs clearly show settlement flow progression
- [ ] firestore rules tests pass (including new settlement test with 'confirmed' status)
