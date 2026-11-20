// ============================================================================
// AGENT 2: @MENTION PARSER
// ============================================================================

class MentionParser {
  /**
   * Parses text for @mentions and resolves them against a user resolver.
   * @param {string} text - The input text containing possible @mentions
   * @param {object} userResolver - Object with findByUsername(username) returning user or null
   * @returns {Array} Array of parsed mentions matching interface contract
   */
  static parse(text, userResolver) {
    if (!text || typeof text !== 'string') return [];

    const mentionRegex = /@([a-zA-Z0-9._-]+)/g;
    const mentions = [];
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      const raw = match[0];
      const username = match[1];
      const start = match.index;
      const end = start + raw.length;

      let userId = null;
      if (userResolver && typeof userResolver.findByUsername === 'function') {
        const user = userResolver.findByUsername(username);
        if (user) {
          userId = user.id;
        }
      }

      mentions.push({
        raw,
        username,
        userId,
        position: { start, end },
      });
    }

    return mentions;
  }
}

module.exports = { MentionParser };
