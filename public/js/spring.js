// A small spring for animating one number from 0 to a target (usually 1).
// It may overshoot a little (the springy feel) but never goes below 0, and
// to() reverses from wherever it is, so rapid back-and-forth never sticks.
// liquidGL forces `transition: none` on its lenses, so lens animations are
// driven from JS through a CSS custom property.

export function createSpring({
  stiffness = 420,
  damping = 28,
  onUpdate,
  onRest,
}) {
  let value = 0;
  let velocity = 0;
  let target = 0;
  let frame = 0;
  let last = 0;

  function rest() {
    cancelAnimationFrame(frame);
    frame = 0;
    value = target;
    velocity = 0;
    onUpdate(value);
    onRest?.(target);
  }

  function step(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    velocity += (-stiffness * (value - target) - damping * velocity) * dt;
    value += velocity * dt;
    if (value <= 0) {
      value = 0;
      velocity = 0;
    }
    if (
      (target === 0 && value === 0) ||
      (Math.abs(value - target) < 0.002 && Math.abs(velocity) < 0.02)
    ) {
      rest();
      return;
    }
    onUpdate(value);
    frame = requestAnimationFrame(step);
  }

  function to(next, { instant = false } = {}) {
    target = next;
    if (instant) {
      rest();
      return;
    }
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(step);
  }

  // Put the value somewhere right now (a finger dragging), stopping any motion.
  function set(next) {
    cancelAnimationFrame(frame);
    frame = 0;
    value = Math.max(0, next);
    velocity = 0;
    onUpdate(value);
  }

  return {
    to,
    set,
    destroy: () => cancelAnimationFrame(frame),
  };
}
