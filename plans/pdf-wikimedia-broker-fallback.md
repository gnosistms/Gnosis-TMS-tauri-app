# Official Wikimedia shortlinks through the broker

1. Add a session-authenticated broker route limited to public Wikimedia projects. Submit URLs, including section anchors, to the official Wikimedia shortener. Share a request budget and honor Wikimedia throttling.
2. Use that route after an explicit Wikimedia IP block. Verify the returned shortlink on the desktop, keep the page-ID fallback, and give existing cached page-ID links a chance to upgrade.
3. Test the broker and PDF export paths before verifying deployment.
