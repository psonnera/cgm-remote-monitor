import re
from playwright.sync_api import Page, expect

def test_ai_eval_fixes(page: Page):
    """
    This test verifies that the "Send to AI" button is disabled during the final call
    and that the final report is rendered before the interim reports.
    """
    # 1. Arrange: Go to the Nightscout homepage and navigate to the reports page.
    # The server is running on port 1337 by default.
    page.goto("http://localhost:1337")

    # Click the "Reports" link.
    page.get_by_role("link", name="Reports").click()

    # Wait for the reports page to load.
    expect(page).to_have_title(re.compile("Reports"))

    # 2. Act: Open the AI Evaluation tab.
    page.get_by_role("link", name="AI Evaluation").click()

    # Click the "Send to AI" button.
    send_button = page.locator("#sendToAiButton")
    send_button.click()

    # 3. Assert: Check the button state and report order.
    # Wait for the button to be disabled and show "Final call...".
    expect(send_button).to_be_disabled()
    expect(send_button).to_have_text("Final call...")

    # Wait for the final report to be rendered.
    expect(page.locator("h1:has-text('Multi‑Day CGM Report')")).to_be_visible()

    # Wait for the interim reports to be rendered after the final report.
    expect(page.locator("h1:has-text('Daily CGM Report')")).to_be_visible()

    # 4. Screenshot: Capture the final result for visual verification.
    page.screenshot(path="jules-scratch/verification/verification.png")