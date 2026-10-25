/*
 * Ticks the elapsed timer on a public card page.
 *
 * The card is server-rendered, so it is readable without JavaScript; this only
 * keeps the clock moving for anyone who has it. A start time of 0 means the
 * card has no timer and nothing is scheduled.
 */
(function () {
  "use strict";

  var time = document.getElementById("card-time");
  if (!time) return;
  var start = Number(time.dataset.start || 0);
  if (!Number.isFinite(start) || start <= 0) return;

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function render() {
    var elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
    var hours = Math.floor(elapsed / 3600);
    var minutes = Math.floor((elapsed % 3600) / 60);
    var seconds = elapsed % 60;
    time.textContent = hours > 0
      ? hours + ":" + pad(minutes) + ":" + pad(seconds)
      : pad(minutes) + ":" + pad(seconds);
  }

  render();
  setInterval(render, 1000);
})();
