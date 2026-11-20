package com.docedit.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.webkit.MimeTypeMap;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 웹으로 만든 편집기 화면을 담는 껍데기. 파일 열기·저장·공유·인쇄·뒤로가기를 이어 준다. */
public class MainActivity extends Activity {
    private static final String HOST = "docedit.app.local";
    private static final int REQ_PICK = 1, REQ_CREATE = 2;

    private WebView web;
    private final Map<String, Uri> files = new HashMap<>();
    private int nextId = 1;
    private Uri pending;          // 다른 앱에서 넘어온, 아직 화면에 전하지 못한 파일
    private boolean jsReady;
    private boolean showDefaults;  // 기본 앱 고르기에서 이 앱이 선택되어 돌아왔다 → 설정 창을 다시 보여 준다
    private FileOutputStream out; // 저장할 내용을 받아 두는 임시 파일
    private String createName;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "NativeBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                return serve(u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (HOST.equals(req.getUrl().getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl())); } catch (Exception ignored) { }
                return true;
            }
        });
        pending = incoming(getIntent());
        showDefaults = isSample(getIntent().getData());
        if (state == null) web.loadUrl("https://" + HOST + "/index.html");
        else web.restoreState(state);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        // 화면을 떠날 때 고치던 내용을 바로 임시저장한다
        web.evaluateJavascript("window.__flushDraft && window.__flushDraft()", null);
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isSample(intent.getData())) { showDefaults = true; if (jsReady) deliverShowDefaults(); return; }
        Uri u = incoming(intent);
        if (u == null) return;
        pending = u;
        if (jsReady) deliverPending();
    }

    // 기본 앱으로 정할 수 있는 형식: {확장자, 기기가 모를 때 쓸 MIME}
    private static final String[][] DEFAULT_TYPES = {
        {"hwp", "application/x-hwp"}, {"hwpx", "application/vnd.hancom.hwpx"},
        {"docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}, {"doc", "application/msword"},
        {"xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}, {"xls", "application/vnd.ms-excel"},
        {"pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"}, {"ppt", "application/vnd.ms-powerpoint"},
        {"pdf", "application/pdf"}, {"txt", "text/plain"},
    };

    /** 그 형식의 파일을 열 때와 똑같은 요청(견본 파일)을 만든다. 파일 관리자가 보내는 MIME과 맞춘다. */
    private Intent sampleIntent(String ext, String fallbackMime) {
        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        Uri u = new Uri.Builder().scheme("content").authority(ShareProvider.AUTHORITY).appendPath(ShareProvider.SAMPLE + ext).build();
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(u, m == null ? fallbackMime : m);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return i;
    }

    private static boolean isSample(Uri u) {
        String last = u == null ? null : u.getLastPathSegment();
        return u != null && ShareProvider.AUTHORITY.equals(u.getAuthority()) && last != null && last.startsWith(ShareProvider.SAMPLE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 기본 앱 고르기 창이나 설정 화면에서 돌아오면 상태를 다시 보여 준다
        if (jsReady) web.evaluateJavascript("window.__native.onDefaultsChanged && window.__native.onDefaultsChanged()", null);
    }

    private Uri incoming(Intent i) {
        if (i == null) return null;
        if (isSample(i.getData())) return null; // 기본 앱 설정용 견본은 문서로 열지 않는다
        if (Intent.ACTION_VIEW.equals(i.getAction())) return i.getData();
        if (Intent.ACTION_SEND.equals(i.getAction())) return i.getParcelableExtra(Intent.EXTRA_STREAM);
        return null;
    }

    private void deliverShowDefaults() {
        if (!showDefaults) return;
        showDefaults = false;
        web.evaluateJavascript("window.__native.onShowDefaults && window.__native.onShowDefaults()", null);
    }

    private void deliverPending() {
        if (pending == null) return;
        Uri u = pending;
        pending = null;
        JSONObject info = register(u);
        if (info != null) call("onIncoming", info.toString());
    }

    /** 화면 쪽 함수 부르기 */
    private void call(String fn, String json) {
        runOnUiThread(() -> web.evaluateJavascript("window.__native." + fn + "(" + json + ")", null));
    }

    private String displayName(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) { }
        String last = u.getLastPathSegment();
        return last == null ? "문서" : last.substring(last.lastIndexOf('/') + 1);
    }

    /** 파일 주소를 등록하고 화면에 넘길 정보를 만든다. 읽을 수 없으면 null */
    private JSONObject register(Uri u) {
        try (InputStream in = getContentResolver().openInputStream(u)) {
            if (in == null) return null;
            String id = String.valueOf(nextId++);
            synchronized (files) { files.put(id, u); }
            return new JSONObject().put("id", id).put("name", displayName(u)).put("uri", u.toString());
        } catch (Exception e) {
            return null;
        }
    }

    private static String mime(String path) {
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
        switch (ext) {
            case "html": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "wasm": return "application/wasm";
            case "json": return "application/json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "woff": return "font/woff";
            case "woff2": return "font/woff2";
            case "ttf": return "font/ttf";
            case "txt": return "text/plain";
            default: return "application/octet-stream";
        }
    }

    private WebResourceResponse serve(String path) {
        try {
            if (path == null || path.equals("/")) path = "/index.html";
            if (path.startsWith("/__file/")) {
                Uri u;
                synchronized (files) { u = files.get(path.substring(8)); }
                if (u == null) throw new Exception("no file");
                return new WebResourceResponse("application/octet-stream", null, getContentResolver().openInputStream(u));
            }
            String m = mime(path);
            boolean text = m.startsWith("text/") || m.endsWith("json") || m.endsWith("xml");
            return new WebResourceResponse(m, text ? "utf-8" : null, getAssets().open("www" + path));
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
        }
    }

    private File tempFile() { return new File(getCacheDir(), "save.tmp"); }

    private void closeOut() {
        try { if (out != null) out.close(); } catch (Exception ignored) { }
        out = null;
    }

    private void copyTempTo(OutputStream os) throws Exception {
        try (InputStream in = new FileInputStream(tempFile()); OutputStream o = os) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
        }
    }

    private boolean writeTo(Uri u) {
        for (String mode : new String[]{"wt", "rwt", "w"}) {
            try {
                OutputStream os = getContentResolver().openOutputStream(u, mode);
                if (os == null) continue;
                copyTempTo(os);
                return true;
            } catch (Exception ignored) { }
        }
        return false;
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        Uri u = result == RESULT_OK && data != null ? data.getData() : null;
        if (u != null) {
            try {
                getContentResolver().takePersistableUriPermission(u, data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
            } catch (Exception ignored) { }
        }
        if (req == REQ_PICK) {
            JSONObject info = u == null ? null : register(u);
            call("onPicked", info == null ? "null" : info.toString());
        } else if (req == REQ_CREATE) {
            final Uri target = u;
            new Thread(() -> {
                String json = "null";
                try {
                    if (target != null && writeTo(target)) json = new JSONObject().put("uri", target.toString()).put("name", displayName(target)).toString();
                } catch (Exception ignored) { }
                call("onSaved", json);
            }).start();
        }
    }

    @Override
    public void onBackPressed() {
        // 뒤로가기는 화면 쪽에서 처리한다(열린 창 닫기 → 편집 끝내기 → 문서 닫기 → 종료 확인)
        web.evaluateJavascript("window.__onBack ? (window.__onBack(), true) : false", v -> { if (!"true".equals(v)) finish(); });
    }

    private class Bridge {
        @JavascriptInterface
        public void pick() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                try { startActivityForResult(i, REQ_PICK); } catch (Exception e) { call("onPicked", "null"); }
            });
        }

        @JavascriptInterface
        public String openUri(String uri) {
            JSONObject info = register(Uri.parse(uri));
            return info == null ? "" : info.toString();
        }

        /** 형식마다 지금 기본 앱이 무엇인지: mine(이 앱) · none(정해지지 않음) · other(다른 앱) */
        @JavascriptInterface
        public String defaultStatus() {
            JSONArray arr = new JSONArray();
            PackageManager pm = getPackageManager();
            for (String[] t : DEFAULT_TYPES) {
                try {
                    Intent i = sampleIntent(t[0], t[1]);
                    ResolveInfo ri = pm.resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY);
                    List<ResolveInfo> all = pm.queryIntentActivities(i, PackageManager.MATCH_DEFAULT_ONLY);
                    String pkg = ri == null || ri.activityInfo == null ? "" : ri.activityInfo.packageName;
                    boolean real = false; // 고르기 창(시스템)이 아니라 실제 앱으로 정해져 있는가
                    for (ResolveInfo r : all) if (r.activityInfo != null && r.activityInfo.packageName.equals(pkg)) real = true;
                    JSONObject o = new JSONObject().put("ext", t[0]);
                    if (real && pkg.equals(getPackageName())) o.put("state", "mine");
                    else if (real) o.put("state", "other").put("pkg", pkg).put("label", String.valueOf(ri.loadLabel(pm)));
                    else o.put("state", "none");
                    arr.put(o);
                } catch (Exception ignored) { }
            }
            return arr.toString();
        }

        /** 시스템의 "연결 프로그램" 창을 띄운다. 거기서 이 앱과 "항상"을 고르면 기본 앱이 된다. */
        @JavascriptInterface
        public void chooseDefault(String ext) {
            for (String[] t : DEFAULT_TYPES) {
                if (!t[0].equals(ext)) continue;
                try {
                    File dir = new File(getCacheDir(), "share");
                    dir.mkdirs();
                    try (FileOutputStream o = new FileOutputStream(new File(dir, ShareProvider.SAMPLE + ext))) { o.write(' '); }
                    Intent i = sampleIntent(t[0], t[1]);
                    runOnUiThread(() -> { try { startActivity(i); } catch (Exception ignored) { } });
                } catch (Exception ignored) { }
            }
        }

        /** 앱 정보 화면 열기(다른 앱의 기본 설정을 풀거나, 이 앱의 기본 설정을 볼 때) */
        @JavascriptInterface
        public void openAppSettings(String pkg) {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + (pkg == null || pkg.isEmpty() ? getPackageName() : pkg)));
            runOnUiThread(() -> { try { startActivity(i); } catch (Exception ignored) { } });
        }

        @JavascriptInterface
        public void ready() {
            jsReady = true;
            runOnUiThread(() -> { deliverPending(); deliverShowDefaults(); });
        }

        @JavascriptInterface
        public void writeBegin() {
            closeOut();
            try { out = new FileOutputStream(tempFile()); } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void writeChunk(String b64) {
            try { out.write(Base64.decode(b64, Base64.DEFAULT)); } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public boolean writeToUri(String uri) {
            closeOut();
            return writeTo(Uri.parse(uri));
        }

        @JavascriptInterface
        public void writeCreate(String name, String mimeType) {
            closeOut();
            createName = name;
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(mimeType);
                i.putExtra(Intent.EXTRA_TITLE, name);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                try { startActivityForResult(i, REQ_CREATE); } catch (Exception e) { call("onSaved", "null"); }
            });
        }

        @JavascriptInterface
        public void writeShare(String name, String mimeType) {
            closeOut();
            try {
                File dir = new File(getCacheDir(), "share");
                dir.mkdirs();
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                String safe = name.replaceAll("[/\\\\]", "_");
                File f = new File(dir, safe);
                copyTempTo(new FileOutputStream(f));
                Uri u = new Uri.Builder().scheme("content").authority(ShareProvider.AUTHORITY).appendPath(safe).build();
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType(mimeType);
                i.putExtra(Intent.EXTRA_STREAM, u);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(i, "공유")));
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void print(String title) {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                pm.print(title, web.createPrintDocumentAdapter(title), new PrintAttributes.Builder().build());
            });
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(MainActivity.this::finishAndRemoveTask);
        }
    }
}
