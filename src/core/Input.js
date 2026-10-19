// Keyboard and mouse. Keys are tracked by KeyboardEvent.code (layout-independent: WASD stays
// where it is on an AZERTY or ЙЦУКЕН keyboard). Mouse movement accumulates between frames and is
// read once per frame with look(). Pointer lock is requested on click and its loss pauses the game.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();      // went down since the last frame
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.mouseDown = false; this.mouseClicked = false;
    this.locked = false;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code); this.pressed.add(e.code);
      if (this.locked && ['Space', 'Tab', 'KeyF'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // (some browsers report one huge jump when the lock begins: ignore it)
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    addEventListener('mousedown', (e) => { if (this.locked && e.button === 0) { this.mouseDown = true; this.mouseClicked = true; } });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.down.clear(); this.mouseDown = false; }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      p?.catch?.(() => this.canvas.requestPointerLock());
    } catch { this.canvas.requestPointerLock(); }
  }

  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  key(code) { return this.down.has(code); }
  hit(code) { return this.pressed.has(code); }

  // the mouse's movement since the last call
  look() { const d = [this.dx, this.dy]; this.dx = 0; this.dy = 0; return d; }

  // the end of a frame: one-shot presses are forgotten
  endFrame() { this.pressed.clear(); this.wheel = 0; this.mouseClicked = false; }
}
