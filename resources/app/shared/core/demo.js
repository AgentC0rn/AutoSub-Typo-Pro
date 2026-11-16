/* Dữ liệu mẫu để xem thử panel ngoài Premiere và chạy test. */
(function (factory) {
  var m = factory();
  if (typeof document === 'undefined' && typeof module === 'object' && module.exports) module.exports = m;
  else (typeof window !== 'undefined' ? window : globalThis).AutoSubDemo = m;
})(function () {
  'use strict';
  // [từ, độ dài (giây), độ to dB]; độ to cao / kéo dài = người nói nhấn mạnh
  var SCRIPT = [
    ['Nói', .22, -24], ['thật', .38, -16], ['nhé,', .2, -26],
    ['nếu', .18, -25], ['bạn', .18, -25], ['đang', .2, -25], ['dựng', .26, -22], ['mọi', .2, -23], ['thứ', .2, -23],
    ['từ', .3, -18], ['đầu,', .42, -15],
    ['thì', .16, -27], ['bạn', .18, -26], ['đang', .2, -26], ['lãng', .36, -15], ['phí', .4, -14], ['thời', .24, -22], ['gian.', .3, -23],
    ['Bạn', .2, -24], ['hoàn', .24, -21], ['thành', .26, -21], ['dự', .22, -22], ['án', .26, -22],
    ['càng', .22, -20], ['nhanh,', .46, -13],
    ['bạn', .18, -25], ['càng', .2, -22], ['sớm', .3, -18], ['nhận', .24, -21],
    ['dự', .28, -16], ['án', .3, -15], ['tiếp', .22, -22], ['theo.', .3, -22]
  ];

  function words() {
    var t = 0.3, out = [];
    SCRIPT.forEach(function (s) {
      out.push({ text: s[0], start: +t.toFixed(3), end: +(t + s[1]).toFixed(3), rms: s[2] });
      t += s[1] + (/[,.]$/.test(s[0]) ? 0.45 : 0.04);
    });
    return out;
  }
  return { words: words };
});
