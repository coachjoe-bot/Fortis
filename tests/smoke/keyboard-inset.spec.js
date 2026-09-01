// ─── T62: iOS keyboard geometry (useKeyboardInset) ────────────────────────────
// On iOS the keyboard never shrinks the layout viewport — the OS pans the page,
// which wedged the chat + Memory-tab composers mid-screen and left grey dead
// bands after dismissal (Will's 08-31 screenshots). The fix pads the 100dvh
// shell / Program modal by the keyboard inset and clamps the document to 0
// while an input is focused. A desktop browser has no real keyboard inset, so
// these specs drive the same signals the hook listens to: shrink
// window.innerHeight (the layout viewport reading) and fire a visualViewport
// resize with an editable focused. What they pin down is the CONTRACT:
//   • focused + shrunk viewport → the shell pads its bottom by the difference
//   • dismissal (viewport restored) → padding fully retired, no leftover gap
//   • while engaged, a panned document snaps back to 0
import { test, expect } from "@playwright/test";
import { mockApi, makeAthlete, loginAsAthlete } from "./mocks.js";

const KB = 320; // fake keyboard height, px

// The 100dvh shell is the composer's flex root: the element whose paddingBottom
// the hook drives. Reached from the composer textarea so the selector tracks
// the real structure instead of a class name.
const shellPad = (page) => page.evaluate(() => {
  const ta = document.querySelector('[data-tour="chat-input"]');
  return ta ? parseInt(getComputedStyle(ta.parentElement).paddingBottom || "0", 10) : null;
});

const fakeKeyboard = async (page, show) => {
  await page.evaluate((args) => {
    const { show, KB } = args;
    if (show) {
      if (!window.__realInnerHeight) window.__realInnerHeight = window.innerHeight;
      Object.defineProperty(window, "innerHeight", { configurable: true, get: () => window.__realInnerHeight + KB });
    } else if (window.__realInnerHeight) {
      Object.defineProperty(window, "innerHeight", { configurable: true, get: () => window.__realInnerHeight });
    }
    window.visualViewport.dispatchEvent(new Event("resize"));
  }, { show, KB });
};

test("keyboard inset pads the shell while the composer is focused and retires on dismiss", async ({ page }) => {
  const athlete = makeAthlete({});
  await mockApi(page, { athlete });
  await loginAsAthlete(page, athlete);

  const composer = page.locator("textarea").last();
  await composer.click();
  await fakeKeyboard(page, true);
  await expect.poll(() => shellPad(page)).toBe(KB);

  // Dismissal: blur + viewport restored → no phantom padding survives.
  await composer.blur();
  await fakeKeyboard(page, false);
  await expect.poll(() => shellPad(page)).toBe(0);
});

test("while the keyboard owns layout, a panned document snaps back to 0", async ({ page }) => {
  const athlete = makeAthlete({});
  await mockApi(page, { athlete });
  await loginAsAthlete(page, athlete);

  await page.locator("textarea").last().click();
  await fakeKeyboard(page, true);
  await expect.poll(() => shellPad(page)).toBe(KB);

  // The OS pan: scroll the document while engaged, then let the hook see a
  // viewport event — the clamp must put it back.
  await page.evaluate(() => {
    document.documentElement.style.height = "200vh"; // give the doc room to pan
    window.scrollTo(0, 120);
    window.visualViewport.dispatchEvent(new Event("scroll"));
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
