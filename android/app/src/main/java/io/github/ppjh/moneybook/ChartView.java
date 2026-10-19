package io.github.ppjh.moneybook;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

final class ChartView extends View {
  static final int[] COLORS = {
    0xffed8a2d,
    0xfff4bb46,
    0xffd56545,
    0xff996fca,
    0xff6f9b69,
    0xffd88aaa,
    0xff72a6c5,
    0xff0891b2,
    0xfff97316,
    0xff3b82f6
  };
  private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Map<String, Long> categories;
  private final List<long[]> months;
  private final List<String> labels;
  private final int textColor, trackColor;

  ChartView(Context context, Map<String, Long> categories, int textColor, int trackColor) {
    super(context);
    this.categories = categories;
    this.months = null;
    this.labels = null;
    this.textColor = textColor;
    this.trackColor = trackColor;
    setContentDescription("分类支出环形图，详细金额见下方分类排行");
  }

  ChartView(
      Context context, List<long[]> months, List<String> labels, int textColor, int trackColor) {
    super(context);
    this.categories = null;
    this.months = new ArrayList<>(months);
    this.labels = new ArrayList<>(labels);
    this.textColor = textColor;
    this.trackColor = trackColor;
    setContentDescription("近六个月收支趋势，详细金额见下方文字");
  }

  private float dp(float value) {
    return value * getResources().getDisplayMetrics().density;
  }

  @Override
  protected void onDraw(Canvas canvas) {
    super.onDraw(canvas);
    paint.setTypeface(android.graphics.Typeface.DEFAULT);
    paint.setTextSize(dp(12));
    paint.setTextAlign(Paint.Align.CENTER);
    if (categories != null) {
      long total = 0;
      for (long amount : categories.values()) total += amount;
      float radius = Math.min(getWidth(), getHeight()) / 2f - dp(20),
          cx = getWidth() / 2f,
          cy = getHeight() / 2f;
      RectF bounds = new RectF(cx - radius, cy - radius, cx + radius, cy + radius);
      paint.setStyle(Paint.Style.STROKE);
      paint.setStrokeWidth(dp(24));
      paint.setColor(trackColor);
      canvas.drawOval(bounds, paint);
      float start = -90;
      int i = 0;
      if (total > 0)
        for (long amount : categories.values()) {
          float sweep = 360f * amount / total;
          paint.setColor(COLORS[i++ % COLORS.length]);
          canvas.drawArc(bounds, start, sweep, false, paint);
          start += sweep;
        }
      paint.setStyle(Paint.Style.FILL);
      paint.setColor(textColor);
      paint.setTextSize(dp(13));
      canvas.drawText("本月支出", cx, cy - dp(6), paint);
      paint.setTextSize(dp(19));
      paint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
      canvas.drawText("¥" + Ledger.money(total), cx, cy + dp(20), paint);
    } else if (months != null) {
      long max = 1;
      for (long[] m : months) max = Math.max(max, Math.max(m[0], m[1]));
      float base = getHeight() - dp(30),
          height = base - dp(18),
          step = getWidth() / 6f,
          width = Math.min(dp(18), step / 4);
      for (int i = 0; i < months.size(); i++) {
        float x = step * (i + .5f);
        long[] m = months.get(i);
        paint.setColor(COLORS[0]);
        canvas.drawRoundRect(
            x - width - dp(2), base - height * m[0] / max, x - dp(2), base, dp(3), dp(3), paint);
        paint.setColor(0xff4b9d72);
        canvas.drawRoundRect(
            x + dp(2), base - height * m[1] / max, x + width + dp(2), base, dp(3), dp(3), paint);
        paint.setColor(textColor);
        paint.setTextSize(dp(12));
        canvas.drawText(labels.get(i), x, base + dp(21), paint);
      }
    }
  }
}
