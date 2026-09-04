function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function isDueForBox(box, lastReviewed, now = new Date()) {
  const day = now.getDay();
  const reviewedAt = lastReviewed ? new Date(lastReviewed) : null;

  if (box === 1) {
    if (!reviewedAt) return true;
    return now.getTime() - reviewedAt.getTime() >= 2 * 60 * 60 * 1000;
  }

  if (box === 2) return true;
  if (box === 3) return day === 3;
  if (box === 4) return day === 6;
  if (box === 5) return day === 0;
  if (box === 6) return now.getDate() >= daysInMonth(now) - 6;

  return false;
}

module.exports = {
  isDueForBox,
};
