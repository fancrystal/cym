package green.cym.app

import java.net.URI
import java.net.URLDecoder

object InvitePolicy {
    fun isTrusted(url: String): Boolean = try {
        val u = URI(url)
        u.scheme == "https" && u.host == "cym.green" && (u.port == -1 || u.port == 443) && u.userInfo == null
    } catch (_: Exception) { false }

    fun isInvite(url: String): Boolean { return try {
        val u = URI(url)
        if (!isTrusted(url) || (u.path != "" && u.path != "/")) false else {
            val fragment = u.rawFragment.orEmpty()
            val query = if (fragment.isNotEmpty()) {
                if (!fragment.startsWith("/login?")) return false
                fragment.substringAfter('?')
            } else u.rawQuery.orEmpty()
            val code = query.split('&').firstOrNull { it.substringBefore('=') == "transfer_invite" }
                ?.substringAfter('=', "")?.let { URLDecoder.decode(it, "UTF-8") }
            code != null && code.matches(Regex("[A-Za-z0-9]{1,32}"))
        }
    } catch (_: Exception) { false } }
    fun normalizeInvite(url: String): String? = try {
        if (isInvite(url)) url else {
            val uri=URI(url)
            if(uri.scheme!="http" || uri.host!="cym.green" || uri.port!=-1 || uri.userInfo!=null) null
            else ("https://"+url.substringAfter("http://")).takeIf { isInvite(it) }
        }
    } catch (_: Exception) { null }
}
