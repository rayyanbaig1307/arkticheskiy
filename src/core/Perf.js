// GPU time per frame (EXT_disjoint_timer_query_webgl2), for the F3 readout and the test harness.
// The query wraps everything a frame draws (the reflection, the shadows, the scene, the post),
// so the median is the frame's real GPU cost, independent of the display's refresh rate.

export class Perf {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = []; this.samples = [];
    this.q = null;
  }
  begin() {
    if (!this.ext) return;
    this.poll();
    if (this.pending.length > 6) return;
    this.q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.q);
  }
  end() {
    if (!this.q) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.q); this.q = null;
  }
  poll() {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift();
      if (!disjoint) { this.samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); if (this.samples.length > 240) this.samples.shift(); }
      gl.deleteQuery(q);
    }
  }
  get median() { const s = [...this.samples].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; }
  get p95() { const s = [...this.samples].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) * 0.95)] : null; }
  reset() { this.samples = []; }
}
