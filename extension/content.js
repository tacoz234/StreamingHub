(function () {
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  }

  function getFocusableElements() {
    const candidates = Array.from(document.querySelectorAll(
      'a[href], button, [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ));
    // Make some likely clickable elements focusable if needed
    const clickable = Array.from(document.querySelectorAll('[onclick], [role="link"], [role="menuitem"], [role="tab"]'));
    for (const el of clickable) {
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    }
    return candidates.concat(clickable).filter(isVisible);
  }

  function focusElement(el) {
    document.querySelectorAll(".unav-focus").forEach((n) => n.classList.remove("unav-focus"));
    el.classList.add("unav-focus");
    el.focus({ preventScroll: false });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function findNextByDirection(current, list, key) {
    const c = current.getBoundingClientRect();
    const cx = c.left + c.width / 2;
    const cy = c.top + c.height / 2;

    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === current) continue;
      const r = el.getBoundingClientRect();
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const dx = ex - cx, dy = ey - cy;

      if (key === "ArrowRight" && dx <= 0) continue;
      if (key === "ArrowLeft" && dx >= 0) continue;
      if (key === "ArrowDown" && dy <= 0) continue;
      if (key === "ArrowUp" && dy >= 0) continue;

      const primary = (key === "ArrowLeft" || key === "ArrowRight") ? Math.abs(dx) : Math.abs(dy);
      const secondary = (key === "ArrowLeft" || key === "ArrowRight") ? Math.abs(dy) : Math.abs(dx);
      const score = primary * 2 + secondary;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function onKeydown(e) {
    const keys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"]);
    if (!keys.has(e.key)) return;

    const list = getFocusableElements();
    if (!list.length) return;

    const current = list.includes(document.activeElement) ? document.activeElement : list[0];

    if (e.key === "Enter") {
      e.preventDefault();
      if (current) {
        // Prefer click, fallback to dispatch
        if (typeof current.click === "function") current.click();
        else current.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      return;
    }

    const next = findNextByDirection(current, list, e.key);
    if (next) {
      e.preventDefault();
      focusElement(next);
    }
  }

  document.addEventListener("keydown", onKeydown, { capture: true });
})();