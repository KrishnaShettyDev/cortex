"""
Email Intelligence Service

Provides Iris-like intelligent email management:
- Email reply generation (learns user's writing style)
- Follow-up tracking system
- Loop people in (CC management)
- Email thread analysis

Uses memories to understand user's communication style and LLM for generation.
"""

import json
import logging
from uuid import UUID
from datetime import datetime, timedelta
from typing import Optional
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, desc

from app.config import get_settings
from app.models.memory import Memory
from app.models.adaptive import UserPreferences as UserPreference
from app.services.sync_service import SyncService
from app.services.search_service import SearchService

settings = get_settings()


class EmailIntelligenceService:
    """
    Intelligent email management service.

    Learns user's communication style and generates contextual replies.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.sync_service = SyncService(db)
        self.search_service = SearchService(db)
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)

    # ==================== WRITING STYLE LEARNING ====================

    async def analyze_writing_style(self, user_id: UUID) -> dict:
        """
        Analyze user's writing style from their sent emails.

        Extracts patterns like:
        - Greeting style ("Hi", "Hey", "Hello", formal vs casual)
        - Sign-off style ("Thanks", "Best", "Cheers")
        - Average sentence length
        - Formality level
        - Common phrases
        """
        # Get sent emails from memories
        result = await self.db.execute(
            select(Memory).where(
                and_(
                    Memory.user_id == user_id,
                    Memory.memory_type == "email",
                    or_(
                        Memory.content.ilike("%from: me%"),
                        Memory.content.ilike("%sent by me%"),
                        Memory.source_type == "sent_email",
                    )
                )
            ).order_by(desc(Memory.memory_date)).limit(50)
        )
        sent_emails = result.scalars().all()

        # If not enough sent emails, try to get them from Composio
        if len(sent_emails) < 10:
            sent_result = await self.sync_service.search_emails(
                user_id=user_id,
                query="in:sent",
                max_results=30,
            )
            # Process would add these to analysis

        if not sent_emails:
            return {
                "success": True,
                "style": self._get_default_style(),
                "confidence": 0.3,
                "message": "Using default style - not enough sent emails to analyze",
            }

        # Analyze the emails with LLM
        email_samples = "\n---\n".join([
            e.content[:1000] for e in sent_emails[:20]
        ])

        style = await self._llm_analyze_style(email_samples)

        # Store learned style
        await self._store_communication_style(user_id, style)

        return {
            "success": True,
            "style": style,
            "confidence": min(0.9, 0.3 + (len(sent_emails) * 0.03)),
            "emails_analyzed": len(sent_emails),
        }

    async def _llm_analyze_style(self, email_samples: str) -> dict:
        """Use LLM to analyze writing style from email samples."""
        system_prompt = """Analyze these email samples and extract the writer's communication style.

Return JSON with:
{
    "greeting_style": "informal|casual|formal",
    "common_greetings": ["Hi", "Hey"],
    "signoff_style": "informal|casual|formal",
    "common_signoffs": ["Thanks", "Best"],
    "tone": "friendly|professional|direct|warm",
    "formality_level": 1-5 (1=very casual, 5=very formal),
    "average_sentence_length": "short|medium|long",
    "uses_exclamation_points": true|false,
    "uses_emojis": true|false,
    "typical_email_length": "brief|moderate|detailed",
    "common_phrases": ["Just checking in", "Hope this helps"],
    "style_notes": "Brief description of their style"
}"""

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Analyze these emails:\n\n{email_samples}"},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=1000,
            )

            return json.loads(response.choices[0].message.content)

        except Exception as e:
            logger.error(f"Error analyzing style: {e}")
            return self._get_default_style()

    def _get_default_style(self) -> dict:
        """Return sensible default style."""
        return {
            "greeting_style": "casual",
            "common_greetings": ["Hi", "Hey"],
            "signoff_style": "casual",
            "common_signoffs": ["Thanks", "Best"],
            "tone": "professional",
            "formality_level": 3,
            "average_sentence_length": "medium",
            "uses_exclamation_points": False,
            "uses_emojis": False,
            "typical_email_length": "moderate",
            "common_phrases": [],
            "style_notes": "Default professional style",
        }

    async def _store_communication_style(self, user_id: UUID, style: dict) -> None:
        """Store learned communication style in preferences."""
        try:
            # Check if preference exists
            result = await self.db.execute(
                select(UserPreference).where(
                    and_(
                        UserPreference.user_id == user_id,
                        UserPreference.preference_type == "communication_style",
                    )
                )
            )
            existing = result.scalar_one_or_none()

            style_json = json.dumps(style)

            if existing:
                existing.preference_value = style_json
                existing.confidence = 0.8
                existing.updated_at = datetime.utcnow()
            else:
                pref = UserPreference(
                    user_id=user_id,
                    preference_type="communication_style",
                    preference_value=style_json,
                    confidence=0.8,
                    evidence="Analyzed from sent emails",
                )
                self.db.add(pref)

            await self.db.commit()

        except Exception as e:
            logger.error(f"Error storing communication style: {e}")

    async def get_communication_style(self, user_id: UUID) -> dict:
        """Get stored communication style or analyze if not exists."""
        try:
            result = await self.db.execute(
                select(UserPreference).where(
                    and_(
                        UserPreference.user_id == user_id,
                        UserPreference.preference_type == "communication_style",
                    )
                )
            )
            pref = result.scalar_one_or_none()

            if pref:
                return json.loads(pref.preference_value)

            # Analyze and store
            analysis = await self.analyze_writing_style(user_id)
            return analysis.get("style", self._get_default_style())

        except Exception as e:
            logger.error(f"Error getting communication style: {e}")
            return self._get_default_style()

    # ==================== EMAIL REPLY GENERATION ====================

    async def generate_reply(
        self,
        user_id: UUID,
        thread_id: str,
        instruction: Optional[str] = None,
        tone_override: Optional[str] = None,
    ) -> dict:
        """
        Generate an intelligent email reply that matches user's style.

        Args:
            user_id: User's ID
            thread_id: Gmail thread ID to reply to
            instruction: Optional specific instruction (e.g., "decline politely")
            tone_override: Override tone ("formal", "casual", "friendly")

        Returns:
            Dict with generated reply, subject, and metadata
        """
        # 1. Get the email thread
        thread_result = await self.sync_service.get_email_thread(
            user_id=user_id,
            thread_id=thread_id,
        )

        if not thread_result.get("success"):
            return {
                "success": False,
                "message": thread_result.get("message", "Failed to load email thread"),
            }

        messages = thread_result.get("messages", [])
        if not messages:
            return {
                "success": False,
                "message": "Email thread is empty",
            }

        # 2. Get user's communication style
        style = await self.get_communication_style(user_id)

        # 3. Get context from memories about the sender
        last_message = messages[-1]
        sender_email = last_message.get("from", "")

        # Search for relevant context
        sender_context = await self._get_sender_context(user_id, sender_email)

        # 4. Generate reply with LLM
        reply = await self._llm_generate_reply(
            messages=messages,
            style=style,
            instruction=instruction,
            tone_override=tone_override,
            sender_context=sender_context,
        )

        return reply

    async def _get_sender_context(self, user_id: UUID, sender_email: str) -> dict:
        """Get context about the sender from memories."""
        context = {
            "relationship": "unknown",
            "previous_topics": [],
            "last_interaction": None,
            "notes": "",
        }

        try:
            # Search for memories about this person
            if sender_email:
                memories = await self.search_service.search(
                    user_id=str(user_id),
                    query=sender_email,
                    limit=5,
                )

                if memories:
                    # Extract context from memories
                    topics = []
                    for m in memories:
                        if m.summary:
                            topics.append(m.summary[:100])

                    context["previous_topics"] = topics[:3]
                    context["last_interaction"] = memories[0].memory_date.isoformat()

                # Try to get person profile
                from app.services.people_service import PeopleService
                people_service = PeopleService(self.db)

                # Search for person by email
                people = await people_service.search_people(
                    user_id=user_id,
                    query=sender_email,
                    limit=1,
                )

                if people:
                    person = people[0]
                    context["relationship"] = person.get("relationship_type", "unknown")
                    context["notes"] = person.get("profile_summary", "")[:200]

        except Exception as e:
            logger.error(f"Error getting sender context: {e}")

        return context

    async def _llm_generate_reply(
        self,
        messages: list,
        style: dict,
        instruction: Optional[str],
        tone_override: Optional[str],
        sender_context: dict,
    ) -> dict:
        """Use LLM to generate a reply in the user's style."""
        # Format thread for context
        thread_text = self._format_thread_for_llm(messages)

        # Build style instructions
        tone = tone_override or style.get("tone", "professional")
        formality = style.get("formality_level", 3)
        greeting = style.get("common_greetings", ["Hi"])[0]
        signoff = style.get("common_signoffs", ["Thanks"])[0]

        style_instructions = f"""
Write in this style:
- Tone: {tone}
- Formality level: {formality}/5
- Greeting style: Start with "{greeting}" or similar
- Sign-off: End with "{signoff}" or similar
- Email length: {style.get('typical_email_length', 'moderate')}
- Exclamation points: {'Yes' if style.get('uses_exclamation_points') else 'Sparingly'}
- Emojis: {'OK to use' if style.get('uses_emojis') else 'Avoid'}
"""

        context_text = ""
        if sender_context.get("relationship") != "unknown":
            context_text = f"""
Context about the sender:
- Relationship: {sender_context.get('relationship')}
- Previous topics: {', '.join(sender_context.get('previous_topics', []))}
- Notes: {sender_context.get('notes', '')}
"""

        instruction_text = instruction or "Write a helpful, appropriate reply"

        system_prompt = f"""You are helping write an email reply. Match the user's natural writing style.

{style_instructions}

{context_text}

INSTRUCTIONS: {instruction_text}

Return JSON:
{{
    "subject": "Re: [original subject]",
    "body": "The email reply body",
    "tone_used": "the tone you used",
    "key_points": ["main points addressed"]
}}"""

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Email thread:\n\n{thread_text}\n\nGenerate a reply."},
                ],
                response_format={"type": "json_object"},
                temperature=0.7,
                max_tokens=1500,
            )

            result = json.loads(response.choices[0].message.content)
            result["success"] = True
            result["thread_id"] = messages[0].get("threadId", "")

            return result

        except Exception as e:
            return {
                "success": False,
                "message": f"Failed to generate reply: {str(e)}",
            }

    def _format_thread_for_llm(self, messages: list) -> str:
        """Format email thread for LLM context."""
        lines = []
        for msg in messages[-5:]:  # Last 5 messages for context
            sender = msg.get("from", "Unknown")
            subject = msg.get("subject", "No Subject")
            body = msg.get("body", msg.get("snippet", ""))[:1000]
            date = msg.get("date", "")

            lines.append(f"From: {sender}")
            lines.append(f"Date: {date}")
            lines.append(f"Subject: {subject}")
            lines.append(f"\n{body}")
            lines.append("\n---\n")

        return "\n".join(lines)

    # ==================== FOLLOW-UP TRACKING ====================

    async def get_awaiting_replies(
        self,
        user_id: UUID,
        days_threshold: int = 3,
    ) -> dict:
        """
        Find emails that are awaiting replies.

        Looks for:
        - Sent emails with no response after X days
        - Important threads that went cold

        Args:
            user_id: User's ID
            days_threshold: Days without reply to flag (default 3)

        Returns:
            Dict with list of emails needing follow-up
        """
        awaiting = []

        try:
            # Get recently sent emails
            sent_result = await self.sync_service.search_emails(
                user_id=user_id,
                query=f"in:sent after:{(datetime.now() - timedelta(days=14)).strftime('%Y/%m/%d')}",
                max_results=50,
            )

            sent_emails = sent_result.get("emails", [])

            for sent in sent_emails:
                thread_id = sent.get("threadId")
                if not thread_id:
                    continue

                # Get full thread to check for replies
                thread_result = await self.sync_service.get_email_thread(
                    user_id=user_id,
                    thread_id=thread_id,
                )

                messages = thread_result.get("messages", [])
                if len(messages) < 1:
                    continue

                # Check if last message is from user (no reply received)
                last_msg = messages[-1]
                last_sender = last_msg.get("from", "")

                # Simple heuristic: if last message is from user, check time
                # In production, would match against user's email
                if "from: me" in last_sender.lower() or sent.get("from") == last_sender:
                    # Calculate days since sent
                    sent_date_str = last_msg.get("date", "")
                    try:
                        # Parse date (various formats)
                        sent_date = datetime.fromisoformat(
                            sent_date_str.replace("Z", "+00:00")
                        )
                        days_ago = (datetime.now(sent_date.tzinfo) - sent_date).days

                        if days_ago >= days_threshold:
                            awaiting.append({
                                "thread_id": thread_id,
                                "subject": sent.get("subject", "No Subject"),
                                "to": sent.get("to", "Unknown"),
                                "sent_date": sent_date_str,
                                "days_without_reply": days_ago,
                                "snippet": sent.get("snippet", "")[:100],
                            })
                    except Exception:
                        pass

        except Exception as e:
            logger.error(f"Error getting awaiting replies: {e}")

        # Sort by days waiting (longest first)
        awaiting.sort(key=lambda x: x.get("days_without_reply", 0), reverse=True)

        return {
            "success": True,
            "awaiting_replies": awaiting[:10],  # Top 10
            "count": len(awaiting),
            "message": f"Found {len(awaiting)} emails awaiting replies",
        }

    async def generate_followup(
        self,
        user_id: UUID,
        thread_id: str,
        urgency: str = "normal",  # "gentle", "normal", "urgent"
    ) -> dict:
        """
        Generate a follow-up email for an unanswered thread.

        Args:
            user_id: User's ID
            thread_id: Thread to follow up on
            urgency: Tone of follow-up

        Returns:
            Dict with generated follow-up
        """
        urgency_instructions = {
            "gentle": "Write a very polite, non-pushy follow-up. Just checking in.",
            "normal": "Write a professional follow-up asking for an update.",
            "urgent": "Write a follow-up emphasizing the importance and requesting a prompt response.",
        }

        return await self.generate_reply(
            user_id=user_id,
            thread_id=thread_id,
            instruction=urgency_instructions.get(urgency, urgency_instructions["normal"]),
        )

    # ==================== LOOP PEOPLE IN (CC MANAGEMENT) ====================

    async def suggest_cc_recipients(
        self,
        user_id: UUID,
        email_content: str,
        current_recipients: list[str],
    ) -> dict:
        """
        Suggest people to CC based on email content and context.

        Args:
            user_id: User's ID
            email_content: Draft email content
            current_recipients: Already added recipients

        Returns:
            Dict with suggested CC recipients
        """
        suggestions = []

        try:
            # Search for relevant people based on email content
            from app.services.people_service import PeopleService
            people_service = PeopleService(self.db)

            # Extract key topics/names from email
            topics = await self._extract_topics_from_email(email_content)

            for topic in topics:
                # Search for people related to this topic
                people = await people_service.search_people(
                    user_id=user_id,
                    query=topic,
                    limit=3,
                )

                for person in people:
                    email = person.get("email")
                    if email and email not in current_recipients:
                        suggestions.append({
                            "email": email,
                            "name": person.get("name", ""),
                            "reason": f"Related to '{topic}'",
                            "relationship": person.get("relationship_type", "unknown"),
                        })

            # Deduplicate
            seen_emails = set()
            unique_suggestions = []
            for s in suggestions:
                if s["email"] not in seen_emails:
                    seen_emails.add(s["email"])
                    unique_suggestions.append(s)

        except Exception as e:
            logger.error(f"Error suggesting CC recipients: {e}")

        return {
            "success": True,
            "suggestions": unique_suggestions[:5],  # Top 5
            "count": len(unique_suggestions),
        }

    async def _extract_topics_from_email(self, content: str) -> list[str]:
        """Extract key topics/names from email content."""
        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "Extract key people names and topics from this email. Return JSON: {\"topics\": [\"name1\", \"topic1\"]}"
                    },
                    {"role": "user", "content": content[:1000]},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=200,
            )

            result = json.loads(response.choices[0].message.content)
            return result.get("topics", [])[:5]

        except Exception as e:
            logger.error(f"Error extracting topics: {e}")
            return []

    async def reply_and_cc(
        self,
        user_id: UUID,
        thread_id: str,
        body: str,
        cc_emails: list[str],
    ) -> dict:
        """
        Reply to an email thread and add CC recipients.

        Args:
            user_id: User's ID
            thread_id: Thread to reply to
            body: Reply body
            cc_emails: Email addresses to CC

        Returns:
            Dict with send result
        """
        return await self.sync_service.reply_to_thread(
            user_id=user_id,
            thread_id=thread_id,
            body=body,
            cc=cc_emails,
        )

    # ==================== EMAIL SUMMARIZATION ====================

    async def summarize_unread(
        self,
        user_id: UUID,
        since: Optional[datetime] = None,
    ) -> dict:
        """
        Summarize unread emails since a given time.

        Like Iris: "Summarize unread emails since last night"

        Args:
            user_id: User's ID
            since: Datetime to look back from (default: 24 hours)

        Returns:
            Dict with summary and categorized emails
        """
        if not since:
            since = datetime.now() - timedelta(hours=24)

        # Search for unread emails
        query = f"is:unread after:{since.strftime('%Y/%m/%d')}"

        result = await self.sync_service.search_emails(
            user_id=user_id,
            query=query,
            max_results=50,
        )

        emails = result.get("emails", [])

        if not emails:
            return {
                "success": True,
                "summary": "No unread emails! Your inbox is clear.",
                "categories": {},
                "count": 0,
            }

        # Categorize and summarize with LLM
        summary = await self._llm_summarize_emails(emails)

        return {
            "success": True,
            **summary,
            "count": len(emails),
        }

    async def _llm_summarize_emails(self, emails: list) -> dict:
        """Use LLM to summarize and categorize emails."""
        # Format emails for LLM
        email_text = "\n---\n".join([
            f"From: {e.get('from', 'Unknown')}\n"
            f"Subject: {e.get('subject', 'No Subject')}\n"
            f"Snippet: {e.get('snippet', '')[:200]}"
            for e in emails[:20]  # Limit for context
        ])

        system_prompt = """Summarize these unread emails concisely. Group by category.

Return JSON:
{
    "summary": "Brief overall summary in 2-3 sentences",
    "categories": {
        "action_required": [{"from": "sender", "subject": "subj", "action": "what to do"}],
        "informational": [{"from": "sender", "subject": "subj", "summary": "brief"}],
        "low_priority": [{"from": "sender", "subject": "subj"}]
    },
    "urgent_count": 0,
    "highlights": ["Key highlight 1", "Key highlight 2"]
}"""

        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Summarize these emails:\n\n{email_text}"},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=1500,
            )

            return json.loads(response.choices[0].message.content)

        except Exception as e:
            return {
                "summary": f"Received {len(emails)} unread emails",
                "categories": {},
                "highlights": [],
            }
