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
import com.facebook.react.bridge.ReactPackage
import com.facebook.react.bridge.NativeModule
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
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import org.json.JSONObject

class PillBoxTodayWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = refresh(context, manager, ids)
  companion object {
    const val PREFERENCES = "pillbox_today_widget"
    const val SNAPSHOT_KEY = "snapshot"
    fun refresh(context: Context, manager: AppWidgetManager, ids: IntArray = manager.getAppWidgetIds(android.content.ComponentName(context, PillBoxTodayWidgetProvider::class.java))) {
      val snapshot = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(SNAPSHOT_KEY, null)?.let { runCatching { JSONObject(it) }.getOrNull() }
      ids.forEach { id ->
        val medium = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) >= 220
        val views = RemoteViews(context.packageName, if (medium) R.layout.pillbox_today_widget_medium else R.layout.pillbox_today_widget_small)
        val preparation = snapshot?.optBoolean("preparationAction") == true
        val slots = snapshot?.optJSONArray("slots")
        val first = if (slots != null && slots.length() > 0) slots.optJSONObject(0) else null
        views.setTextViewText(R.id.widget_title, if (preparation) "Préparer mon pilulier" else "PillBox aujourd’hui")
        val detail = if (preparation) "Votre préparation est à faire aujourd’hui." else when (first?.optString("state")) { "VALIDATED" -> "Prochaine prise validée"; "DUE" -> "Prise à prendre · \${first.optInt('medicationCount')} médicament(s)"; else -> if (first == null) "Aucune prise prévue aujourd’hui" else "Prochaine prise · \${first.optInt('medicationCount')} médicament(s)" }
        views.setTextViewText(R.id.widget_detail, detail)
        if (medium) views.setTextViewText(R.id.widget_slots, slots?.let { "\${it.length()} créneau(x) aujourd’hui" } ?: "")
        val target = if (preparation) "pillbox://preparations/new" else first?.optString("target") ?: "pillbox://"
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, target.hashCode(), Intent(Intent.ACTION_VIEW, Uri.parse(target), context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        manager.updateAppWidget(id, views)
      }
    }
  }
}
`,
  'src/main/res/layout/pillbox_today_widget_small.xml': `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:id="@+id/widget_root" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:padding="12dp" android:background="#FFFDF9"><TextView android:id="@+id/widget_title" android:layout_width="match_parent" android:layout_height="wrap_content" android:textColor="#24322D" android:textStyle="bold" android:textSize="16sp"/><TextView android:id="@+id/widget_detail" android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="6dp" android:textColor="#5E6B66" android:textSize="14sp"/></LinearLayout>`,
  'src/main/res/layout/pillbox_today_widget_medium.xml': `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:id="@+id/widget_root" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:padding="16dp" android:background="#FFFDF9"><TextView android:id="@+id/widget_title" android:layout_width="match_parent" android:layout_height="wrap_content" android:textColor="#24322D" android:textStyle="bold" android:textSize="18sp"/><TextView android:id="@+id/widget_detail" android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="8dp" android:textColor="#24322D" android:textSize="15sp"/><TextView android:id="@+id/widget_slots" android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_marginTop="8dp" android:textColor="#5E6B66" android:textSize="14sp"/></LinearLayout>`,
  'src/main/res/xml/pillbox_today_widget.xml': `<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android" android:minWidth="180dp" android:minHeight="90dp" android:resizeMode="horizontal|vertical" android:updatePeriodMillis="1800000" android:initialLayout="@layout/pillbox_today_widget_small" android:widgetCategory="home_screen" />`,
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
