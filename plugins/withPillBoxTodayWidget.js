const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('expo/config-plugins');

const PACKAGE_PATH = 'com/perrinelv/pillbox';
const PROVIDER = 'com.perrinelv.pillbox.PillBoxTodayWidgetProvider';

const files = {
  [`src/main/java/${PACKAGE_PATH}/PillBoxTodayWidgetModule.kt`]: `package com.perrinelv.pillbox

import android.appwidget.AppWidgetManager
import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.NativeModule
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager

class PillBoxTodayWidgetModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "PillBoxTodayWidget"
  @ReactMethod fun saveSnapshot(snapshot: String, promise: Promise) {
    context.getSharedPreferences(PillBoxTodayWidgetProvider.PREFERENCES, Context.MODE_PRIVATE).edit().putString(PillBoxTodayWidgetProvider.SNAPSHOT_KEY, snapshot).apply()
    PillBoxTodayWidgetProvider.refresh(context, AppWidgetManager.getInstance(context))
    promise.resolve(null)
  }
}

class PillBoxTodayWidgetPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PillBoxTodayWidgetModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`,
  [`src/main/java/${PACKAGE_PATH}/PillBoxTodayWidgetProvider.kt`]: `package com.perrinelv.pillbox

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Le widget ne décide de rien : il pose les chaînes déjà mises en mots par
 * \`buildTodayWidgetSnapshot\` (src/domain/widget/today-widget.ts). Aucune règle
 * métier ni aucune formulation ne vit ici, où elles échapperaient aux tests.
 */
class PillBoxTodayWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refresh(context, manager, ids)

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: android.os.Bundle) =
    refresh(context, manager, intArrayOf(id))

  companion object {
    const val PREFERENCES = "pillbox_today_widget"
    const val SNAPSHOT_KEY = "snapshot"

    /** Largeur à partir de laquelle la liste des médicaments tient. */
    private const val MEDIUM_MIN_WIDTH_DP = 220

    private val ROW_IDS = intArrayOf(R.id.widget_row_1, R.id.widget_row_2, R.id.widget_row_3)
    private val NAME_IDS = intArrayOf(R.id.widget_row_1_name, R.id.widget_row_2_name, R.id.widget_row_3_name)
    private val QTY_IDS = intArrayOf(R.id.widget_row_1_qty, R.id.widget_row_2_qty, R.id.widget_row_3_qty)
    private val CHECK_IDS = intArrayOf(R.id.widget_row_1_check, R.id.widget_row_2_check, R.id.widget_row_3_check)
    private val DIVIDER_IDS = intArrayOf(R.id.widget_row_2_divider, R.id.widget_row_3_divider)

    fun refresh(
      context: Context,
      manager: AppWidgetManager,
      ids: IntArray = manager.getAppWidgetIds(ComponentName(context, PillBoxTodayWidgetProvider::class.java)),
    ) {
      val snapshot = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .getString(SNAPSHOT_KEY, null)
        ?.let { runCatching { JSONObject(it) }.getOrNull() }
      val display = snapshot?.optJSONObject("display")
      ids.forEach { id ->
        val medium = manager.getAppWidgetOptions(id)
          .getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) >= MEDIUM_MIN_WIDTH_DP
        val views = RemoteViews(
          context.packageName,
          if (medium) R.layout.pillbox_today_widget_medium else R.layout.pillbox_today_widget_small,
        )
        bind(context, views, display, medium)
        manager.updateAppWidget(id, views)
      }
    }

    private fun bind(context: Context, views: RemoteViews, display: JSONObject?, medium: Boolean) {
      views.setTextViewText(R.id.widget_eyebrow, display?.optString("eyebrow") ?: "Aujourd’hui")
      views.setTextViewText(R.id.widget_title, display?.optString("title") ?: "PillBox")
      views.setTextViewText(R.id.widget_detail, display?.optString("detail") ?: "")

      val action = display?.optString("actionLabel")?.takeIf { it.isNotEmpty() && it != "null" }
      val validated = display?.optBoolean("validated") == true
      views.setViewVisibility(R.id.widget_action, if (action != null) View.VISIBLE else View.GONE)
      views.setViewVisibility(R.id.widget_validated, if (action == null && validated) View.VISIBLE else View.GONE)
      if (action != null) views.setTextViewText(R.id.widget_action, "✓  " + action)

      if (medium) bindMedications(views, display?.optJSONArray("medications"))

      val target = display?.optString("target")?.takeIf { it.isNotEmpty() } ?: "pillbox://"
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(target), context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val pending = PendingIntent.getActivity(
        context,
        target.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      views.setOnClickPendingIntent(R.id.widget_root, pending)
      views.setOnClickPendingIntent(R.id.widget_action, pending)
    }

    private fun bindMedications(views: RemoteViews, medications: org.json.JSONArray?) {
      val count = medications?.length() ?: 0
      views.setViewVisibility(R.id.widget_panel, if (count > 0) View.VISIBLE else View.GONE)
      ROW_IDS.indices.forEach { index ->
        val medication = if (index < count) medications?.optJSONObject(index) else null
        views.setViewVisibility(ROW_IDS[index], if (medication != null) View.VISIBLE else View.GONE)
        if (index > 0) {
          views.setViewVisibility(DIVIDER_IDS[index - 1], if (medication != null) View.VISIBLE else View.GONE)
        }
        if (medication == null) return@forEach
        views.setTextViewText(NAME_IDS[index], medication.optString("name"))
        views.setTextViewText(QTY_IDS[index], medication.optString("quantity"))
        val checked = medication.optBoolean("checked")
        views.setTextViewText(CHECK_IDS[index], if (checked) "✓" else "")
        views.setInt(
          CHECK_IDS[index],
          "setBackgroundResource",
          if (checked) R.drawable.pillbox_widget_check_on else R.drawable.pillbox_widget_check_off,
        )
      }
    }
  }
}
`,
  'src/main/res/drawable/pillbox_widget_background.xml': `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="#17332B"/>
  <corners android:radius="26dp"/>
</shape>`,
  'src/main/res/drawable/pillbox_widget_panel.xml': `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="#12FFFDF9"/>
  <stroke android:width="1dp" android:color="#21FFFDF9"/>
  <corners android:radius="14dp"/>
</shape>`,
  'src/main/res/drawable/pillbox_widget_action.xml': `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="#E08A65"/>
  <corners android:radius="17dp"/>
</shape>`,
  'src/main/res/drawable/pillbox_widget_check_on.xml': `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
  <solid android:color="#9CBFB0"/>
</shape>`,
  'src/main/res/drawable/pillbox_widget_check_off.xml': `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
  <solid android:color="#00000000"/>
  <stroke android:width="2dp" android:color="#52FFFDF9"/>
</shape>`,
  'src/main/res/layout/pillbox_today_widget_small.xml': `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:id="@+id/widget_root"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:orientation="vertical"
  android:padding="16dp"
  android:background="@drawable/pillbox_widget_background">
  <TextView android:id="@+id/widget_eyebrow" android:layout_width="match_parent" android:layout_height="wrap_content" android:textColor="#9CBFB0" android:textSize="10sp" android:textStyle="bold" android:letterSpacing="0.1" android:singleLine="true" android:ellipsize="end"/>
  <TextView android:id="@+id/widget_title" android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="10dp" android:textColor="#FFFDF9" android:textSize="21sp" android:textStyle="bold" android:maxLines="2" android:ellipsize="end"/>
  <TextView android:id="@+id/widget_detail" android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="5dp" android:textColor="#9CBFB0" android:textSize="12sp" android:singleLine="true" android:ellipsize="end"/>
  <FrameLayout android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1"/>
  <TextView android:id="@+id/widget_action" android:layout_width="match_parent" android:layout_height="34dp" android:gravity="center" android:background="@drawable/pillbox_widget_action" android:textColor="#17332B" android:textSize="12.5sp" android:textStyle="bold" android:singleLine="true"/>
  <TextView android:id="@+id/widget_validated" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="✓  Validé" android:textColor="#C7DDD2" android:textSize="12sp" android:textStyle="bold" android:visibility="gone"/>
</LinearLayout>`,
  'src/main/res/layout/pillbox_today_widget_medium.xml': `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:id="@+id/widget_root"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:orientation="vertical"
  android:paddingTop="16dp"
  android:paddingBottom="16dp"
  android:paddingLeft="18dp"
  android:paddingRight="18dp"
  android:background="@drawable/pillbox_widget_background">
  <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal" android:gravity="center_vertical">
    <LinearLayout android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:orientation="vertical">
      <TextView android:id="@+id/widget_eyebrow" android:layout_width="match_parent" android:layout_height="wrap_content" android:textColor="#9CBFB0" android:textSize="10sp" android:textStyle="bold" android:letterSpacing="0.1" android:singleLine="true" android:ellipsize="end"/>
      <LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="5dp" android:orientation="horizontal" android:baselineAligned="true">
        <TextView android:id="@+id/widget_title" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textColor="#FFFDF9" android:textSize="22sp" android:textStyle="bold" android:singleLine="true" android:ellipsize="end"/>
        <TextView android:id="@+id/widget_detail" android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:layout_marginLeft="8dp" android:textColor="#9CBFB0" android:textSize="12sp" android:singleLine="true" android:ellipsize="end"/>
      </LinearLayout>
    </LinearLayout>
    <TextView android:id="@+id/widget_action" android:layout_width="wrap_content" android:layout_height="32dp" android:layout_marginLeft="10dp" android:gravity="center" android:paddingLeft="14dp" android:paddingRight="14dp" android:background="@drawable/pillbox_widget_action" android:textColor="#17332B" android:textSize="12sp" android:textStyle="bold" android:singleLine="true"/>
    <TextView android:id="@+id/widget_validated" android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginLeft="10dp" android:text="✓  Validé" android:textColor="#C7DDD2" android:textSize="12sp" android:textStyle="bold" android:singleLine="true" android:visibility="gone"/>
  </LinearLayout>
  <LinearLayout android:id="@+id/widget_panel" android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="10dp" android:orientation="vertical" android:background="@drawable/pillbox_widget_panel">
  <LinearLayout android:id="@+id/widget_row_1" android:layout_width="match_parent" android:layout_height="36dp" android:orientation="horizontal" android:gravity="center_vertical" android:paddingLeft="12dp" android:paddingRight="12dp">
    <TextView android:id="@+id/widget_row_1_name" android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:textColor="#FFFDF9" android:textSize="13sp" android:textStyle="bold" android:singleLine="true" android:ellipsize="end"/>
    <TextView android:id="@+id/widget_row_1_qty" android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginLeft="7dp" android:textColor="#9CBFB0" android:textSize="11.5sp" android:singleLine="true"/>
    <TextView android:id="@+id/widget_row_1_check" android:layout_width="20dp" android:layout_height="20dp" android:layout_marginLeft="10dp" android:gravity="center" android:background="@drawable/pillbox_widget_check_off" android:textColor="#17332B" android:textSize="11sp" android:textStyle="bold"/>
  </LinearLayout>
  <FrameLayout android:id="@+id/widget_row_2_divider" android:layout_width="match_parent" android:layout_height="1dp" android:background="#1AFFFDF9"/>
  <LinearLayout android:id="@+id/widget_row_2" android:layout_width="match_parent" android:layout_height="36dp" android:orientation="horizontal" android:gravity="center_vertical" android:paddingLeft="12dp" android:paddingRight="12dp">
    <TextView android:id="@+id/widget_row_2_name" android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:textColor="#FFFDF9" android:textSize="13sp" android:textStyle="bold" android:singleLine="true" android:ellipsize="end"/>
    <TextView android:id="@+id/widget_row_2_qty" android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginLeft="7dp" android:textColor="#9CBFB0" android:textSize="11.5sp" android:singleLine="true"/>
    <TextView android:id="@+id/widget_row_2_check" android:layout_width="20dp" android:layout_height="20dp" android:layout_marginLeft="10dp" android:gravity="center" android:background="@drawable/pillbox_widget_check_off" android:textColor="#17332B" android:textSize="11sp" android:textStyle="bold"/>
  </LinearLayout>
  <FrameLayout android:id="@+id/widget_row_3_divider" android:layout_width="match_parent" android:layout_height="1dp" android:background="#1AFFFDF9"/>
  <LinearLayout android:id="@+id/widget_row_3" android:layout_width="match_parent" android:layout_height="36dp" android:orientation="horizontal" android:gravity="center_vertical" android:paddingLeft="12dp" android:paddingRight="12dp">
    <TextView android:id="@+id/widget_row_3_name" android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:textColor="#FFFDF9" android:textSize="13sp" android:textStyle="bold" android:singleLine="true" android:ellipsize="end"/>
    <TextView android:id="@+id/widget_row_3_qty" android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginLeft="7dp" android:textColor="#9CBFB0" android:textSize="11.5sp" android:singleLine="true"/>
    <TextView android:id="@+id/widget_row_3_check" android:layout_width="20dp" android:layout_height="20dp" android:layout_marginLeft="10dp" android:gravity="center" android:background="@drawable/pillbox_widget_check_off" android:textColor="#17332B" android:textSize="11sp" android:textStyle="bold"/>
  </LinearLayout>
  </LinearLayout>
</LinearLayout>`,
  'src/main/res/xml/pillbox_today_widget.xml': `<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:minWidth="110dp"
  android:minHeight="110dp"
  android:targetCellWidth="2"
  android:targetCellHeight="2"
  android:resizeMode="horizontal|vertical"
  android:updatePeriodMillis="1800000"
  android:initialLayout="@layout/pillbox_today_widget_small"
  android:previewLayout="@layout/pillbox_today_widget_medium"
  android:widgetCategory="home_screen" />`,
};

module.exports = function withPillBoxTodayWidget(config) {
  config = withDangerousMod(config, [
    'android',
    (mod) => {
      for (const [relativePath, content] of Object.entries(files)) {
        const destination = path.join(
          mod.modRequest.platformProjectRoot,
          'app',
          relativePath,
        );
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, content);
      }
      return mod;
    },
  ]);
  config = withMainApplication(config, (mod) => {
    if (!mod.modResults.contents.includes('add(PillBoxTodayWidgetPackage())')) {
      mod.modResults.contents = mod.modResults.contents.replace(
        '// Packages that cannot be autolinked yet can be added manually here, for example:',
        'add(PillBoxTodayWidgetPackage())\n              // Packages that cannot be autolinked yet can be added manually here, for example:',
      );
    }
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) throw new Error('Application Android introuvable.');
    application.receiver ??= [];
    if (
      !application.receiver.some(
        (receiver) => receiver.$?.['android:name'] === PROVIDER,
      )
    ) {
      application.receiver.push({
        $: {
          'android:name': '.PillBoxTodayWidgetProvider',
          'android:exported': 'false',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.appwidget.action.APPWIDGET_UPDATE',
                },
              },
            ],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': '@xml/pillbox_today_widget',
            },
          },
        ],
      });
    }
    return mod;
  });
};
