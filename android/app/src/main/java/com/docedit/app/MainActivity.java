package com.docedit.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
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
        Uri u = incoming(intent);
        if (u == null) return;
        pending = u;
        if (jsReady) deliverPending();
    }

    private Uri incoming(Intent i) {
        if (i == null) return null;
        if (Intent.ACTION_VIEW.equals(i.getAction())) return i.getData();
        if (Intent.ACTION_SEND.equals(i.getAction())) return i.getParcelableExtra(Intent.EXTRA_STREAM);
        return null;
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

        @JavascriptInterface
        public void ready() {
            jsReady = true;
            runOnUiThread(MainActivity.this::deliverPending);
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
