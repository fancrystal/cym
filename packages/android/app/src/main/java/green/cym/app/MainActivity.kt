package green.cym.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.zxing.integration.android.IntentIntegrator
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var offline: View
    private lateinit var errorMessage: TextView
    private var chooser: ValueCallback<Array<Uri>>? = null
    private var pageReady = false
    private var h5Ready = false
    private var mainFailed = false
    private var webViewSupported = true
    private var lastUrl = "https://cym.green/"
    private var pendingInvite: String? = null
    private val pickerRequest = 1007
    private val home = "https://cym.green/"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val frame = FrameLayout(this)
        web = WebView(this)
        frame.addView(web, FrameLayout.LayoutParams(-1, -1))
        val errorPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(android.graphics.Color.WHITE)
            visibility = View.GONE
            errorMessage = TextView(this@MainActivity).apply { text = "网络连接失败，请检查网络后重试"; textSize = 17f; gravity = Gravity.CENTER }
            addView(errorMessage)
            addView(Button(this@MainActivity).apply { text = "重新加载"; setOnClickListener { if(webViewSupported)loadHome() else recreate() } })
        }
        offline = errorPanel
        frame.addView(offline, FrameLayout.LayoutParams(-1, -1))
        setContentView(frame)
        configureWebView()
        val incoming = intent?.dataString?.let { InvitePolicy.normalizeInvite(it) }
        lastUrl = incoming ?: home
        if (webViewSupported) web.loadUrl(lastUrl) else { errorMessage.text = "系统 WebView 版本过低，请更新 Android System WebView 后重试"; offline.visibility=View.VISIBLE }
    }

    private fun loadHome() { offline.visibility = View.GONE; web.loadUrl(lastUrl) }

    private fun configureWebView() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "CymNative", setOf("https://cym.green"), object : WebViewCompat.WebMessageListener {
                override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
                    if (!isMainFrame || sourceOrigin.toString() != "https://cym.green") return
                    try {
                        val data = JSONObject(message.data ?: return)
                        when (data.optString("type")) {
                            "ready" -> runOnUiThread { h5Ready = true; if(pageReady)offline.visibility=View.GONE; flushInvite() }
                            "scan" -> runOnUiThread { startScan() }
                            "share" -> {
                                val url = data.optString("url")
                                if (InvitePolicy.isInvite(url)) runOnUiThread { shareInvite(url) }
                            }
                        }
                    } catch (_: Exception) { /* invalid messages are ignored */ }
                }
            })
        } else {
            webViewSupported = false
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                val url = request.url.toString()
                if (InvitePolicy.isTrusted(url)) return false
                if (request.url.scheme in listOf("http", "https")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) { Toast.makeText(this@MainActivity, "无法打开外部链接", Toast.LENGTH_SHORT).show() }
                }
                return true
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) { pageReady = false; h5Ready = false; mainFailed = false; if(url != null && InvitePolicy.isTrusted(url))lastUrl=url; super.onPageStarted(view,url,favicon) }
            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view,url)
                pageReady = !mainFailed && url != null && InvitePolicy.isTrusted(url)
                if (pageReady) { offline.visibility = View.GONE; flushInvite(); web.postDelayed({ if(pageReady && !h5Ready && !isFinishing){errorMessage.text="页面加载失败，请更新 Android System WebView 后重试";offline.visibility=View.VISIBLE} },15000) }
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) { mainFailed = true; pageReady = false; errorMessage.text="网络连接失败，请检查网络后重试"; offline.visibility = View.VISIBLE }
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, error: WebResourceResponse) {
                if(request.isForMainFrame && error.statusCode>=400){mainFailed=true;pageReady=false;errorMessage.text="网站暂时无法访问，请稍后重试";offline.visibility=View.VISIBLE}
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton("确定") { _, _ -> result.confirm() }.setOnCancelListener { result.cancel() }.show(); return true
            }
            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(message).setPositiveButton("确定") { _, _ -> result.confirm() }.setNegativeButton("取消") { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.show(); return true
            }
            override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean {
                val input = EditText(this@MainActivity); input.setText(defaultValue.orEmpty())
                AlertDialog.Builder(this@MainActivity).setMessage(message).setView(input).setPositiveButton("确定") { _, _ -> result.confirm(input.text.toString()) }.setNegativeButton("取消") { _, _ -> result.cancel() }.setOnCancelListener { result.cancel() }.show(); return true
            }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                chooser?.onReceiveValue(null); chooser = callback
                return try { startActivityForResult(params.createIntent(), pickerRequest); true } catch (_: Exception) { chooser?.onReceiveValue(null); chooser = null; Toast.makeText(this@MainActivity,"无法打开文件选择器",Toast.LENGTH_SHORT).show(); true }
            }
        }
    }

    private fun startScan() {
        try { IntentIntegrator(this).setDesiredBarcodeFormats(IntentIntegrator.QR_CODE).setPrompt("扫描本地商圈邀请二维码").setBeepEnabled(false).setOrientationLocked(false).initiateScan() }
        catch (_: Exception) { Toast.makeText(this,"无法打开扫码，请检查相机权限",Toast.LENGTH_SHORT).show() }
    }
    private fun shareInvite(url: String) {
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "邀请你加入本地商圈：$url")
        try { startActivity(Intent.createChooser(intent,"分享邀请")) } catch (_: Exception) { Toast.makeText(this,"无法打开分享",Toast.LENGTH_SHORT).show() }
    }
    private fun dispatchInvite(url: String) {
        val safeUrl=InvitePolicy.normalizeInvite(url)
        if (safeUrl==null) { Toast.makeText(this,"不是有效的商圈邀请链接",Toast.LENGTH_SHORT).show(); return }
        if (!pageReady || !h5Ready) { pendingInvite = safeUrl; if (offline.visibility == View.VISIBLE) loadHome(); return }
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('cym-invite',{detail:${JSONObject.quote(safeUrl)}}))", null)
    }
    private fun flushInvite() { if(pageReady && h5Ready) { val url=pendingInvite;pendingInvite=null;if(url!=null)dispatchInvite(url) } }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); intent.dataString?.let { dispatchInvite(it) } }
    @Deprecated("Android compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        if (requestCode == pickerRequest) {
            val selected = WebChromeClient.FileChooserParams.parseResult(resultCode,data)?.filter { it.scheme == "content" }?.toTypedArray()
            chooser?.onReceiveValue(selected?.takeIf { it.isNotEmpty() }); chooser = null; return
        }
        val result = IntentIntegrator.parseActivityResult(requestCode,resultCode,data)
        if (result?.contents != null) dispatchInvite(result.contents)
    }
    @Deprecated("Android compatibility")
    override fun onBackPressed() {
        if (offline.visibility == View.VISIBLE) { AlertDialog.Builder(this).setMessage("退出本地商圈？").setPositiveButton("退出") { _, _ -> finish() }.setNegativeButton("取消",null).show(); return }
        web.evaluateJavascript("window.dispatchEvent(new Event('cym-native-back',{cancelable:true}))") { result ->
            if (result == "true" || result == "null") {
                if (web.canGoBack()) web.goBack() else AlertDialog.Builder(this).setMessage("退出本地商圈？").setPositiveButton("退出") { _, _ -> finish() }.setNegativeButton("取消",null).show()
            }
        }
    }
    override fun onDestroy() { chooser?.onReceiveValue(null); chooser=null; web.destroy(); super.onDestroy() }
}
