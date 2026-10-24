const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`[${msg.type()}] ${msg.text()}`);
  });
  
  page.on('pageerror', error => {
    console.log(`[PAGE ERROR] ${error.message}`);
  });
  
  try {
    // Sign in first
    await page.goto('http://localhost:8100/auth', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const signUpTab = await page.$('button.mode-tab:has-text("Sign Up")');
    if (signUpTab) {
      await signUpTab.click();
      await page.waitForTimeout(1000);
    }
    
    const displayNameInput = await page.$('input[type="text"], ion-input[type="text"] input');
    const emailInput = await page.$('input[type="email"], ion-input[type="email"] input');
    const passwordInput = await page.$('input[type="password"], ion-input[type="password"] input');
    
    if (displayNameInput && emailInput && passwordInput) {
      await displayNameInput.fill('Test User 8');
      await emailInput.fill('testuser8@example.com');
      await passwordInput.fill('password123');
      
      const submitButton = await page.$('ion-button.submit-btn, button:has-text("Create Account")');
      if (submitButton) {
        await submitButton.click();
        await page.waitForTimeout(5000);
        console.log('Signed up, URL:', page.url());
      }
    }
    
    // Go to products to add items
    await page.goto('http://localhost:8100/products', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    const addToCartButtons = await page.$$('button:has-text("Add"), ion-button:has-text("Add")');
    if (addToCartButtons.length > 0) {
      await addToCartButtons[0].click();
      await page.waitForTimeout(3000);
    }
    
    // Go to cart
    await page.goto('http://localhost:8100/cart', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    // Fill in delivery address - use ion-textarea
    const addressInput = await page.$('ion-textarea#delivery-address');
    if (addressInput) {
      // ion-textarea has an internal input
      const innerInput = await addressInput.$('input, textarea');
      if (innerInput) {
        await innerInput.fill('123 Test Street, Manila, Philippines');
        console.log('Filled address via inner input');
      } else {
        // Try using evaluate to set the value
        await addressInput.evaluate(el => {
          el.value = '123 Test Street, Manila, Philippines';
          el.dispatchEvent(new Event('ionChange'));
        });
        console.log('Filled address via evaluate');
      }
      await page.waitForTimeout(1000);
    }
    
    // Click Continue to Payment
    const continueButton = await page.$('button.place-order-btn, button:has-text("Continue to Payment")');
    if (continueButton) {
      await continueButton.click();
      console.log('Clicked Continue to Payment');
      await page.waitForTimeout(5000);
      console.log('URL after click:', page.url());
      
      // Check for payment outcome screen
      const paymentOutcome = await page.$('.pay-result, [class*="pay-result"]');
      console.log('Payment outcome screen found:', paymentOutcome ? 'yes' : 'no');
    }
    
    await page.waitForTimeout(5000);
  } catch (error) {
    console.log(`Navigation error: ${error.message}`);
  }
  
  await browser.close();
})();