package green.cym.app

import org.junit.Assert.*
import org.junit.Test

class InvitePolicyTest {
    @Test fun acceptsOnlyCymInviteLinks() {
        assertTrue(InvitePolicy.isInvite("https://cym.green/#/login?transfer_invite=ABC123"))
        assertTrue(InvitePolicy.isInvite("https://cym.green/?transfer_invite=ABC123"))
        assertFalse(InvitePolicy.isInvite("https://cym.green.evil.test/#/login?transfer_invite=ABC123"))
        assertFalse(InvitePolicy.isInvite("http://cym.green/#/login?transfer_invite=ABC123"))
        assertFalse(InvitePolicy.isInvite("https://cym.green/#/login?transfer_invite=%3Cbad%3E"))
        assertFalse(InvitePolicy.isInvite("https://cym.green/#/other?transfer_invite=ABC123"))
        assertEquals("https://cym.green/#/login?transfer_invite=ABC123", InvitePolicy.normalizeInvite("http://cym.green/#/login?transfer_invite=ABC123"))
        assertNull(InvitePolicy.normalizeInvite("http://cym.green.evil.test/#/login?transfer_invite=ABC123"))
    }
}
