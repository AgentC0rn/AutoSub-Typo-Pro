/* Ngữ nghĩa tiếng Việt tối giản cho ngắt cụm phụ đề thông minh (dùng chung Node & Browser UMD). */
(function (factory) {
  var m = factory();
  if (typeof document === 'undefined' && typeof module === 'object' && module.exports) module.exports = m;
  else (typeof window !== 'undefined' ? window : globalThis).AutoSubViPhrases = m;
})(function () {
  'use strict';

  function toSet(s) {
    var o = {};
    s.trim().split(/\s+/).forEach(function (w) { if (w) o[w] = 1; });
    return o;
  }
  function pairSet(list) {
    var o = {};
    list.forEach(function (p) { o[p] = 1; });
    return o;
  }
  function norm(t) {
    var s = String(t || '');
    if (s.normalize) s = s.normalize('NFC');
    return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  }
  function endsClause(t) { return /[.!?…,;:]["'”’)\]]*$/.test(String(t || '')); }
  function endsSentence(t) { return /[.!?…]["'”’)\]]*$/.test(String(t || '')); }
  function isCapStart(t) { return /^["'“‘(\[]?\p{Lu}/u.test(String(t || '').trim()); }

  // Cụm từ ghép / quán ngữ 2 âm tiết gắn chặt (không tách giữa hai từ).
  var VI_COMPOUNDS = pairSet([
    'công nghệ', 'kỹ thuật', 'hàn băng', 'mát lạnh', 'siêu mát', 'triệt lông', 'nang lông',
    'liệu trình', 'liều trình', 'năng lông', 'cơ địa', 'hiệu quả', 'phù hợp', 'phương pháp',
    'năng lượng', 'khách hàng', 'cảm nhận', 'đầu tiên', 'khác biệt', 'tư vấn', 'ưu đãi',
    'chuyên sâu', 'chuyên nghiệp', 'tái tạo', 'phục hồi', 'chăm sóc', 'làm đẹp', 'thẩm mỹ',
    'làn da', 'tình trạng', 'sản phẩm', 'thực hiện', 'cam kết', 'an toàn', 'tự nhiên',
    'lâu dài', 'hoàn toàn', 'tất cả', 'hầu hết', 'phần lớn', 'bao giờ', 'sự thật', 'rõ ràng',
    'nhanh chóng', 'dễ dàng', 'đơn giản', 'thời gian', 'kinh nghiệm', 'trải nghiệm',
    'chất lượng', 'dịch vụ', 'uy tín', 'hỗ trợ', 'sử dụng', 'cải thiện', 'giải quyết',
    'vấn đề', 'nguyên nhân', 'kết quả', 'tác dụng', 'bảo vệ', 'ngăn ngừa', 'điều trị',
    'kiểm tra', 'đánh giá', 'lựa chọn', 'phân biệt', 'quy trình', 'tiêu chuẩn', 'cơ sở',
    'địa chỉ', 'chi phí', 'giá trị', 'chương trình', 'thông tin', 'nhắn tin', 'hệ thống',
    'công cụ', 'thiết bị', 'tính năng', 'ứng dụng', 'màn hình', 'nội dung', 'hình ảnh',
    'âm thanh', 'bình thường', 'đặc biệt', 'quan trọng', 'cần thiết', 'chính xác',
    'tuyệt đối', 'trực tiếp', 'tương đối', 'tối đa', 'tối thiểu', 'lập tức', 'thường xuyên',
    'liên tục', 'dần dần', 'hằng ngày', 'hiện đại', 'tiên tiến', 'nổi bật', 'ấn tượng',
    'tinh tế', 'mềm mại', 'mịn màng', 'căng bóng', 'trắng sáng', 'sạch sẽ', 'hết sạch',
    'tổn thương', 'kích ứng', 'phản ứng', 'tế bào', 'sắc tố', 'chân lông', 'lỗ chân',
    'da đầu', 'mồ hôi', 'cơ thể', 'gương mặt', 'vùng da', 'nếp nhăn', 'bác sĩ', 'chuyên gia',
    'nhân viên', 'đội ngũ', 'bạn bè', 'gia đình', 'cuộc sống', 'công việc', 'phát triển',
    'thành công', 'thay đổi', 'tạo nên', 'bỏ sót', 'đa điểm', 'thế hệ', 'công suất',
    'tốc độ', 'nhiệt độ', 'bước sóng', 'chân thực', 'hài lòng', 'tin tưởng', 'yên tâm',
    'tuyệt vời', 'miễn phí', 'đăng ký', 'liên hệ', 'chỉ còn', 'chắc chắn', 'hầu như',
    'dường như', 'tuy nhiên', 'ngoài ra', 'vì vậy', 'cho nên', 'tức là', 'nghĩa là',
    'nghĩ rằng', 'cho rằng', 'biết rằng', 'thấy rằng', 'tin rằng', 'nói rằng',
    'các bạn', 'mọi người', 'chúng ta', 'chúng tôi', 'hôm nay', 'ngày mai', 'bây giờ',
    'hiện tại', 'sau này', 'trước đây', 'buổi đầu', 'lần đầu', 'cuối cùng', 'vẫn còn',
    'đang còn', 'nếu như', 'mặc dù', 'tuy rằng', 'bởi vì', 'do đó', 'thế nên', 'vừa rồi',
    'thật sự', 'thực sự', 'vô cùng', 'cực kỳ', 'hoàn hảo', 'nâng cơ', 'trẻ hóa',
    'trẻ hoá', 'giảm béo', 'trị mụn', 'tàn nhang', 'thâm nám', 'phun xăm', 'nối mi',
    'gội đầu', 'dưỡng sinh', 'thư giãn', 'inbox ngay', 'từ từ', 'ngay từ',
    'không hẳn', 'không chỉ', 'hết lông', 'dự án', 'lãng phí', 'thành phố', 'việt nam'
  ]);

  // Cụm danh từ mở đầu cần bổ ngữ theo sau (tránh kết thúc cụm ở "... công nghệ | hàn băng").
  var TRAILING_HEAD_COMPOUNDS = pairSet([
    'công nghệ', 'kỹ thuật', 'phương pháp', 'liệu trình', 'tình trạng', 'vấn đề',
    'nguyên nhân', 'quá trình', 'hệ thống', 'dịch vụ', 'sản phẩm', 'cơ chế',
    'mức độ', 'khả năng', 'giải pháp', 'tác dụng', 'năng lượng', 'máy móc'
  ]);

  // Từ đầu mệnh đề thực sự khi Whisper viết hoa giữa câu (hoặc từ tiếng Việt có dấu viết hoa đầu câu mới).
  var CAP_CLAUSE_WORDS = toSet(
    'và nhưng nếu thì mà vì do để khi lúc sau trước tại ở trong ngoài với ' +
    'còn tuy mặc dù dù bởi hãy đừng không chưa chỉ ngay phần điều khách mọi người ai hết triệt inbox'
  );

  function isTrailingHeadCompound(prev2, prev1) {
    if (!prev2 || !prev1 || endsClause(prev1.text)) return false;
    return !!TRAILING_HEAD_COMPOUNDS[norm(prev2.text) + ' ' + norm(prev1.text)];
  }
  function isAsciiToken(t) { return /^["'“‘(\[]?[A-Za-z][A-Za-z0-9-]*[,.;!?…"'”’)\]]*$/.test(String(t || '').trim()); }

  // Từ chức năng đầu cụm: không để đứng trơ trọi ở cuối cụm chữ.
  var TRAILING_HEADS = toSet(
    'ở tại trong ngoài trên dưới giữa cạnh gần với của cho về từ đến tới bằng theo qua sang vào sau trước ' +
    'và hay hoặc nhưng mà thì là nếu vì do bởi khi lúc để như rằng ' +
    'rất quá hơi siêu cực càng khá đã đang sẽ vẫn cũng đều chỉ còn không chưa chẳng hãy đừng ' +
    'phải cần nên bị được nằm gồm một hai ba bốn năm những các mọi từng mỗi nhiều ít vài mức ' +
    'cái chiếc con loại người điều sự việc'
  );

  // Tiểu từ / bổ ngữ cuối câu: không dùng để mở đầu cụm mới nếu ghép được vào cụm trước.
  var LEADING_TAILS = toSet(
    'nha nhé nhỉ ạ đấy đó này kia ấy vậy thôi rồi luôn ngay nữa hết xong lắm đâu chứ rằng thế cơ á hả sao'
  );

  // Giới từ / liên từ mở cụm mới tự nhiên khi đứng sau danh từ / động từ kết cụm trước.
  var PHRASE_STARTERS = toSet(
    'ở tại với khi nếu vì để nhưng mà thì và hay hoặc sau trước trong ngoài còn'
  );

  function isNumberToken(n) { return /^\d+(?:[.,]\d+)?[%kđmv]?$/.test(n); }
  function isUnitOrClassifier(n) { return /^(?:buổi|lần|ngày|tuần|tháng|năm|giờ|phút|giây|cái|chiếc|người|khách|suất|ca|gói|liệu|các|những|k|tr|triệu|nghìn|ngàn|tỷ|%|đồng)$/.test(n); }
  function isQuantifierSubject(prev, cur, next) {
    if (!prev || !cur || !next || endsClause(prev.text)) return false;
    var np = norm(prev.text), nc = norm(cur.text), nn = norm(next.text);
    return isNumberToken(nc) && /^(?:các|những|người|khách|chị|em|bạn)$/.test(nn) && !TRAILING_HEADS[np];
  }

  function isCompoundPair(a, b, nextB) {
    if (!a || !b) return false;
    var at = a.text, bt = b.text;
    if (endsClause(at)) return false;
    var na = norm(at), nb = norm(bt);
    if (!na || !nb) return false;
    if (VI_COMPOUNDS[na + ' ' + nb]) return true;
    if (isNumberToken(na) && isUnitOrClassifier(nb)) return true;
    // Bổ ngữ là tên công nghệ/thương hiệu Latinh không dấu đứng sau động/danh từ thường ("triệt Biomatic", "công nghệ HIFU").
    if (!isCapStart(at) && isCapStart(bt) && isAsciiToken(bt) && !CAP_CLAUSE_WORDS[nb] && !TRAILING_HEADS[na]) return true;
    // Hai từ viết hoa liền nhau: coi là tên riêng trừ khi `b` là khởi đầu mệnh đề
    if (isCapStart(at) && isCapStart(bt) && Math.max(0, b.start - a.end) < 0.16) {
      if (nextB && !isCapStart(nextB.text) && (CAP_CLAUSE_WORDS[nb] || TRAILING_HEADS[nb] || VI_COMPOUNDS[nb + ' ' + norm(nextB.text)])) {
        return false;
      }
      return true;
    }
    return false;
  }

  function isTrailingHead(w) { return !!TRAILING_HEADS[norm(w && w.text)]; }
  function isLeadingTail(w) { return !!LEADING_TAILS[norm(w && w.text)]; }
  function isPhraseStarter(w) { return !!PHRASE_STARTERS[norm(w && w.text)]; }

  function isClauseBoundaryCap(prev, next, afterNext) {
    if (!prev || !next || endsClause(prev.text)) return false;
    if (!isCapStart(next.text)) return false;
    var nb = norm(next.text);
    if (!isCapStart(prev.text)) {
      if (CAP_CLAUSE_WORDS[nb] || TRAILING_HEADS[nb]) return true;
      // Từ tiếng Việt có dấu viết hoa sau từ thường (Whisper ngắt câu tự động dù thiếu dấu chấm).
      if (!isAsciiToken(next.text)) return true;
      return false;
    }
    if (afterNext && !isCapStart(afterNext.text) && (!isAsciiToken(next.text) || CAP_CLAUSE_WORDS[nb] || TRAILING_HEADS[nb] || VI_COMPOUNDS[nb + ' ' + norm(afterNext.text)])) {
      return true;
    }
    return false;
  }

  return {
    norm: norm,
    endsClause: endsClause,
    endsSentence: endsSentence,
    isCapStart: isCapStart,
    isCompoundPair: isCompoundPair,
    isTrailingHead: isTrailingHead,
    isTrailingHeadCompound: isTrailingHeadCompound,
    isLeadingTail: isLeadingTail,
    isPhraseStarter: isPhraseStarter,
    isClauseBoundaryCap: isClauseBoundaryCap,
    isQuantifierSubject: isQuantifierSubject,
    VI_COMPOUNDS: VI_COMPOUNDS
  };
});
