/** 파면 애니메이션 시계. 실제 시간(초)에 감속 비율을 곱해 시뮬레이션 시간을 진행한다. */
export class WaveClock {
  t = 0; // 시뮬레이션 시간 [s] (실제 음속 기준)
  tMax = 0.05; // 종료 시간 [s]
  playing = false;
  speed = 0.01; // 감속 비율: 1이면 실시간, 0.01이면 1/100 속도
  loop = true;

  /** 실제 경과 시간 dt [s]만큼 진행. 끝에 닿으면 반복하거나 정지한다. */
  tick(dt: number): void {
    if (!this.playing) return;
    this.t += dt * this.speed;
    if (this.t >= this.tMax) {
      if (this.loop) this.t = this.t % Math.max(this.tMax, 1e-9);
      else {
        this.t = this.tMax;
        this.playing = false;
      }
    }
  }

  seek(t: number): void {
    this.t = Math.min(this.tMax, Math.max(0, t));
  }
}
