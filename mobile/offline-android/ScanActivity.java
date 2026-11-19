package th.ac.aru.eventpass.scantest;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.*;
import android.net.Uri;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;

public final class ScanActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView view;
    private PermissionRequest pending;

    private static boolean local(Uri url) {
        return "https".equals(url.getScheme()) && HOST.equals(url.getAuthority());
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        view = new WebView(this);
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setDomStorageEnabled(true);
        view.getSettings().setAllowFileAccess(false);
        view.getSettings().setAllowContentAccess(false);
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !local(r.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri url = r.getUrl();
                String path = url.getPath();
                if(local(url) && path != null && !path.contains("..") && path.startsWith("/")) {
                    String asset = path.equals("/") ? "index.html" : path.substring(1);
                    String type = asset.endsWith(".js") ? "application/javascript" :
                        asset.endsWith(".css") ? "text/css" : asset.endsWith(".jpg") ? "image/jpeg" : "text/html";
                    try { return new WebResourceResponse(type,"UTF-8",getAssets().open(asset)); }
                    catch(IOException ignored) { }
                }
                return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",
                    Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest r) {
                if(!local(r.getOrigin()) || !java.util.Arrays.asList(r.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
                    r.deny(); return;
                }
                if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED) {
                    r.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); return;
                }
                if(pending!=null) { r.deny(); return; }
                pending=r;
                requestPermissions(new String[]{Manifest.permission.CAMERA},1);
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest r) {
                if(pending==r) pending=null;
            }
        });
        setContentView(view);
        view.loadUrl("https://"+HOST+"/");
    }

    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(request,permissions,results);
        if(request!=1 || pending==null) return;
        if(results.length>0 && results[0]==PackageManager.PERMISSION_GRANTED)
            pending.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else pending.deny();
        pending=null;
    }
    @Override protected void onDestroy() {
        if(pending!=null) pending.deny();
        view.destroy();
        super.onDestroy();
    }
}
