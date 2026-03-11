import OpenAI, { toFile } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { qdrantService } from './qdrant.service';
import { embeddingService } from './embedding.service';
import { logger } from '../utils/logger';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { prisma } from '../lib/prisma';
const openai = new OpenAI({ apiKey: config.openai.apiKey });
const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

class WebhookService {

  // ─── Extract Bitrix24 webhook auth token ──────────────────────────────────
  // Webhook URL format: https://domain/rest/{userId}/{token}/

  private extractAuthToken(): string {
    const parts = config.bitrix24.webhookUrl.replace(/\/$/, '').split('/');
    return parts[parts.length - 1] || '';
  }

  // ─── Fetch activity from Bitrix24 ─────────────────────────────────────────

  private async fetchActivity(activityId: string): Promise<any> {
    const url = `${config.bitrix24.webhookUrl}crm.activity.get.json`;
    const response = await axios.post(url, { id: activityId });
    if (response.data.error) throw new Error(`Bitrix24 crm.activity.get: ${response.data.error_description}`);
    return response.data.result;
  }

  // ─── Fetch Bitrix24 user details ──────────────────────────────────────────

  private async fetchBitrixUser(bitrixUserId: string): Promise<any | null> {
    try {
      const url = `${config.bitrix24.webhookUrl}user.get.json`;
      const res = await axios.post(url, { filter: { ID: bitrixUserId } });
      const users: any[] = res.data?.result || [];
      return users[0] || null;
    } catch (err: any) {
      logger.warn(`Could not fetch Bitrix24 user ${bitrixUserId}: ${err.message}`);
      return null;
    }
  }

  // ─── Fetch lead/contact details from Bitrix24 ─────────────────────────────

  private async fetchBitrixEntity(ownerId: string, ownerTypeId: string): Promise<any | null> {
    try {
      const method = ownerTypeId === '1' ? 'crm.lead.get' : 'crm.contact.get';
      const url = `${config.bitrix24.webhookUrl}${method}.json`;
      const res = await axios.post(url, { id: ownerId });
      return res.data.result || null;
    } catch (err: any) {
      logger.warn(`Could not fetch Bitrix24 entity ${ownerId}: ${err.message}`);
      return null;
    }
  }

  // ─── Detect audio format from Content-Type header ────────────────────────

  private detectAudioFormat(contentType: string): { ext: string; mime: string } {
    const ct = (contentType || '').toLowerCase().split(';')[0].trim();
    const map: Record<string, { ext: string; mime: string }> = {
      'audio/ogg':       { ext: 'ogg',  mime: 'audio/ogg' },
      'audio/oga':       { ext: 'oga',  mime: 'audio/ogg' },
      'audio/opus':      { ext: 'ogg',  mime: 'audio/ogg' },
      'audio/wav':       { ext: 'wav',  mime: 'audio/wav' },
      'audio/wave':      { ext: 'wav',  mime: 'audio/wav' },
      'audio/x-wav':     { ext: 'wav',  mime: 'audio/wav' },
      'audio/mp4':       { ext: 'm4a',  mime: 'audio/mp4' },
      'audio/m4a':       { ext: 'm4a',  mime: 'audio/mp4' },
      'audio/mpeg':      { ext: 'mp3',  mime: 'audio/mpeg' },
      'audio/mp3':       { ext: 'mp3',  mime: 'audio/mpeg' },
      'audio/flac':      { ext: 'flac', mime: 'audio/flac' },
      'audio/webm':      { ext: 'webm', mime: 'audio/webm' },
      'video/mp4':       { ext: 'mp4',  mime: 'video/mp4' },
      'video/webm':      { ext: 'webm', mime: 'video/webm' },
      'application/ogg': { ext: 'ogg',  mime: 'audio/ogg' },
    };
    return map[ct] ?? { ext: 'mp3', mime: 'audio/mpeg' };
  }

  // ─── Download audio buffer ────────────────────────────────────────────────
  // Method 1: Bitrix24 Disk REST API  → uses webhook token, always works.
  // Method 2: Direct crm_show_file URL → requires OAuth session, often fails.

  private async fetchAudioBuffer(
    audioFile: any,
    directUrl: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string } | null> {
    logger.info(`Audio file object from Bitrix24: ${JSON.stringify(audioFile)}`);

    const filename = audioFile?.name || audioFile?.NAME || 'call';

    // ── Method 1: disk.file.get via webhook token ─────────────────────────
    // The id field in the FILES array is the Bitrix24 Disk file ID.
    const fileId = audioFile?.id || audioFile?.ID;
    if (fileId) {
      try {
        const diskRes = await axios.post(
          `${config.bitrix24.webhookUrl}disk.file.get.json`,
          { id: fileId },
        );
        const fileInfo = diskRes.data?.result;
        if (fileInfo?.DOWNLOAD_URL) {
          logger.info(`disk.file.get OK — downloading ${fileInfo.NAME || filename}`);
          const dl = await axios.get(fileInfo.DOWNLOAD_URL, { responseType: 'arraybuffer' });
          const ct = dl.headers['content-type'] || fileInfo.MIME_TYPE || 'audio/mpeg';
          if (!ct.includes('text/html')) {
            return { buffer: Buffer.from(dl.data), filename: fileInfo.NAME || filename, contentType: ct };
          }
          logger.warn(`disk.file.get DOWNLOAD_URL also returned HTML`);
        } else {
          logger.warn(`disk.file.get returned no DOWNLOAD_URL. Result: ${JSON.stringify(fileInfo)}`);
        }
      } catch (err: any) {
        logger.warn(`disk.file.get failed (id=${fileId}): ${err.message}`);
      }
    }

    // ── Method 2: Direct URL fallback ─────────────────────────────────────
    if (directUrl) {
      try {
        const res = await axios.get(directUrl, { responseType: 'arraybuffer' });
        const ct = res.headers['content-type'] || '';
        if (!ct.includes('text/html')) {
          return { buffer: Buffer.from(res.data), filename, contentType: ct };
        }
        const preview = Buffer.from(res.data).toString('utf-8', 0, 400);
        logger.error(`Direct audio URL returned HTML (webhook token rejected by crm_show_file.php).\nHTML preview: ${preview}`);
      } catch (err: any) {
        logger.warn(`Direct audio URL download failed: ${err.message}`);
      }
    }

    return null;
  }

  // ─── Transcribe audio ─────────────────────────────────────────────────────

  private async transcribeAudio(audioFile: any, directUrl: string): Promise<string | null> {
    try {
      const result = await this.fetchAudioBuffer(audioFile, directUrl);
      if (!result) {
        logger.error('Could not download audio — skipping transcription');
        return null;
      }

      const { buffer, filename, contentType } = result;
      const { ext, mime } = this.detectAudioFormat(contentType);
      const safeName = /\.\w{2,5}$/.test(filename) ? filename : `${filename}.${ext}`;

      logger.info(`Transcribing: ${safeName} (${mime}, ${buffer.length} bytes)`);

      const transcription = await openai.audio.transcriptions.create({
        file: await toFile(buffer, safeName, { type: mime }),
        model: config.openai.whisperModel,
      });

      logger.info(`Transcription complete: ${transcription.text?.length || 0} chars`);
      return transcription.text || null;
    } catch (err: any) {
      logger.error(`Audio transcription failed: ${err.message}`);
      return null;
    }
  }

  // ─── Generate call summary and sentiment via Claude ──────────────────────

  private async generateCallInsights(
    transcript: string,
  ): Promise<{ summary: string | null; sentiment: string | null }> {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content:
              `Analyze this call transcript and respond with ONLY a JSON object (no markdown, no extra text):\n\n` +
              `{"summary":"2-3 sentence summary of what was discussed","sentiment":"positive|negative|neutral"}\n\n` +
              `Transcript:\n${transcript}`,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');

      const parsed = JSON.parse(jsonMatch[0]);
      const summary = typeof parsed.summary === 'string' ? parsed.summary : null;
      const sentiment = ['positive', 'negative', 'neutral'].includes(parsed.sentiment)
        ? parsed.sentiment
        : 'neutral';

      logger.info(`Call insights generated — sentiment: ${sentiment}`);
      return { summary, sentiment };
    } catch (err: any) {
      logger.warn(`Call insights generation failed: ${err.message}`);
      return { summary: null, sentiment: null };
    }
  }

  // ─── Post transcript/summary/sentiment to Bitrix24 timeline ──────────────

  private async saveToBitrix24Timeline(params: {
    ownerId: string;
    ownerTypeId: string;
    transcript: string;
    summary: string | null;
    sentiment: string | null;
    direction: string;
    phoneNumber: string | null;
    duration: number | null;
  }): Promise<string | null> {
    try {
      const entityType = params.ownerTypeId === '1' ? 'LEAD' : 'CONTACT';

      const durationStr = params.duration !== null
        ? ` (${Math.floor(params.duration / 60)}m ${params.duration % 60}s)`
        : '';

      let comment =
        `${params.direction === 'inbound' ? 'Incoming' : 'Outgoing'} call` +
        (params.phoneNumber ? ` — ${params.phoneNumber}` : '') +
        durationStr;

      if (params.summary) comment += `\n\nSummary:\n${params.summary}`;
      if (params.sentiment) comment += `\n\nSentiment: ${params.sentiment}`;
      comment += `\n\nTranscript:\n${params.transcript}`;

      const url = `${config.bitrix24.webhookUrl}crm.timeline.comment.add.json`;
      const response = await axios.post(url, {
        fields: {
          ENTITY_ID: params.ownerId,
          ENTITY_TYPE: entityType,
          COMMENT: comment,
        },
      });

      if (response.data.error) {
        logger.warn(`Bitrix24 timeline comment error: ${response.data.error_description}`);
        return null;
      }

      const commentId = String(response.data.result || '');
      logger.info(`Bitrix24 timeline comment added (id=${commentId}) for ${entityType} ${params.ownerId}`);
      return commentId;
    } catch (err: any) {
      logger.warn(`Failed to post Bitrix24 timeline comment: ${err.message}`);
      return null;
    }
  }

  // ─── Process Bitrix24 Activity Webhook (MyHub calls) ─────────────────────
  // Triggered when a call activity is added or updated in Bitrix24.

  async processBitrix24Activity(payload: any) {
    const webhookLog = await prisma.webhookLog.create({
      data: {
        source: 'bitrix24',
        eventType: payload?.event || 'activity',
        payload,
        processed: false,
      },
    });

    try {
      const activityId = payload?.data?.FIELDS?.ID;
      if (!activityId) throw new Error('Missing activity ID in webhook payload');

      const eventType = payload?.event || '';
      const isUpdate = eventType.toUpperCase().includes('UPDATE');

      logger.info(`Processing Bitrix24 activity ${activityId} (${eventType})`);

      // Fetch full activity details
      const activity = await this.fetchActivity(activityId);

      // Only process calls (TYPE_ID=2)
      if (String(activity.TYPE_ID) !== '2') {
        logger.info(`Activity ${activityId} is not a call (TYPE_ID=${activity.TYPE_ID}), skipping`);
        await prisma.webhookLog.update({ where: { id: webhookLog.id }, data: { processed: true } });
        return { success: true, skipped: true, reason: 'Not a call activity' };
      }

      // Deduplication check
      const existing = await prisma.callRecording.findFirst({
        where: { bitrixActivityId: String(activityId) },
      });
      if (existing && !isUpdate) {
        logger.info(`Activity ${activityId} already processed, skipping`);
        await prisma.webhookLog.update({ where: { id: webhookLog.id }, data: { processed: true } });
        return { success: true, skipped: true, reason: 'Duplicate', callRecordingId: existing.id };
      }

      // ── Resolve agent by RESPONSIBLE_ID — auto-create if not found ──────────
      let agent = await prisma.agent.findFirst({
        where: { bitrixUserId: String(activity.RESPONSIBLE_ID) },
      });

      if (!agent) {
        logger.info(`Agent not found for bitrixUserId=${activity.RESPONSIBLE_ID} — auto-creating`);
        const bitrixUser = await this.fetchBitrixUser(String(activity.RESPONSIBLE_ID));

        const name = bitrixUser
          ? `${bitrixUser.NAME || ''} ${bitrixUser.LAST_NAME || ''}`.trim() || `Agent ${activity.RESPONSIBLE_ID}`
          : `Agent ${activity.RESPONSIBLE_ID}`;

        // Always use the placeholder email as the safe default.
        // Admin can update to the real email later in the panel.
        // Using real email here risks a unique-constraint collision if the email
        // already belongs to another agent or admin account.
        const email = `bitrix_${activity.RESPONSIBLE_ID}@placeholder.local`;

        try {
          agent = await prisma.agent.create({
            data: {
              bitrixUserId: String(activity.RESPONSIBLE_ID),
              name,
              email,
              role: 'agent',
              // passwordHash null — admin sets password before the agent can log in
            },
          });
          logger.info(`Auto-created agent ${agent.id} (${name}) for bitrixUserId=${activity.RESPONSIBLE_ID}`);
        } catch (createErr: any) {
          // Race condition: another concurrent event already created it — just fetch it
          agent = await prisma.agent.findFirst({
            where: { bitrixUserId: String(activity.RESPONSIBLE_ID) },
          });
          if (!agent) {
            logger.error(`Failed to create or find agent for bitrixUserId=${activity.RESPONSIBLE_ID}: ${createErr.message}`);
            await prisma.webhookLog.update({
              where: { id: webhookLog.id },
              data: { processed: false, errorMessage: `Agent create failed: ${createErr.message}` },
            });
            return { success: false, reason: 'Agent creation failed' };
          }
          logger.info(`Agent ${agent.id} was created by a concurrent event — reusing it`);
        }
      }

      // ── Resolve lead by OWNER_ID ──────────────────────────────────────────
      let lead = await prisma.lead.findFirst({
        where: { bitrixLeadId: String(activity.OWNER_ID), agentId: agent.id },
      });

      if (!lead && activity.OWNER_ID) {
        const details = await this.fetchBitrixEntity(String(activity.OWNER_ID), String(activity.OWNER_TYPE_ID));
        lead = await prisma.lead.create({
          data: {
            bitrixLeadId: String(activity.OWNER_ID),
            agentId: agent.id,
            name: details
              ? `${details.NAME || ''} ${details.LAST_NAME || ''}`.trim() || details.TITLE || `Lead ${activity.OWNER_ID}`
              : `Lead ${activity.OWNER_ID}`,
            phone: details?.PHONE?.[0]?.VALUE || null,
            email: details?.EMAIL?.[0]?.VALUE || null,
            status: details?.STATUS_ID || null,
            source: 'bitrix24_call',
          },
        });
        logger.info(`Created lead ${lead.id} for OWNER_ID=${activity.OWNER_ID}`);
      }

      if (!lead) {
        logger.warn(`No lead for OWNER_ID=${activity.OWNER_ID}, skipping activity ${activityId}`);
        await prisma.webhookLog.update({
          where: { id: webhookLog.id },
          data: { processed: false, errorMessage: `Lead not found for OWNER_ID=${activity.OWNER_ID}` },
        });
        return { success: false, reason: 'Lead not found' };
      }

      // ── Parse call metadata ───────────────────────────────────────────────
      const direction = String(activity.DIRECTION) === '1' ? 'inbound' : 'outbound';

      const duration =
        activity.START_TIME && activity.END_TIME
          ? Math.max(0, Math.floor(
              (new Date(activity.END_TIME).getTime() - new Date(activity.START_TIME).getTime()) / 1000
            ))
          : null;

      const phoneMatch = (activity.SUBJECT || '').match(/(\+?[\d\s]+\d)/);
      const phoneNumber = phoneMatch ? phoneMatch[1].replace(/\s/g, '') : null;

      // ── Get audio file ────────────────────────────────────────────────────
      const files: any[] = activity.FILES || [];
      const audioFile = files[0];
      const authToken = this.extractAuthToken();
      const audioUrl = audioFile ? `${audioFile.url}${authToken}` : null;

      // ── Transcribe ────────────────────────────────────────────────────────
      let transcriptText: string | null = null;
      if (audioFile && audioUrl) {
        transcriptText = await this.transcribeAudio(audioFile, audioUrl);
      } else {
        logger.info(`Activity ${activityId} has no audio file yet`);
      }

      // ── Generate summary + sentiment (only if new transcript) ─────────────
      let summaryText: string | null = null;
      let sentiment: string | null = null;
      if (transcriptText) {
        const insights = await this.generateCallInsights(transcriptText);
        summaryText = insights.summary;
        sentiment = insights.sentiment;
      }

      // ── Save / update call_recordings ─────────────────────────────────────
      let callRecording;
      if (existing && isUpdate) {
        callRecording = await prisma.callRecording.update({
          where: { id: existing.id },
          data: {
            transcriptText: transcriptText || existing.transcriptText,
            summaryText: summaryText || existing.summaryText,
            sentiment: sentiment || existing.sentiment,
            audioUrl: audioUrl || existing.audioUrl,
            duration: duration ?? existing.duration,
            direction,
            isTranscribed: !!(transcriptText || existing.transcriptText),
            metadata: {
              ...(existing.metadata as object || {}),
              activityId,
              eventType,
              subject: activity.SUBJECT,
            },
          },
        });
        logger.info(`Updated call_recording ${existing.id}`);
      } else {
        callRecording = await prisma.callRecording.create({
          data: {
            agentId: agent.id,
            leadId: lead.id,
            bitrixActivityId: String(activityId),
            phoneNumber: phoneNumber || 'unknown',
            direction,
            duration,
            audioUrl,
            transcriptText,
            summaryText,
            sentiment,
            isTranscribed: !!transcriptText,
            metadata: {
              activityId,
              eventType,
              subject: activity.SUBJECT,
              responsibleId: activity.RESPONSIBLE_ID,
            },
          },
        });
        logger.info(`Created call_recording ${callRecording.id}`);
      }

      // ── Save to messages + embed (only if transcript available) ───────────
      const finalTranscript = transcriptText || (existing && isUpdate ? callRecording.transcriptText : null);
      const finalSummary = summaryText || (existing && isUpdate ? callRecording.summaryText : null);
      const finalSentiment = sentiment || (existing && isUpdate ? callRecording.sentiment : null);

      if (finalTranscript) {
        const durationStr = duration !== null
          ? ` (${Math.floor(duration / 60)}m ${duration % 60}s)`
          : '';
        let content =
          `${direction === 'inbound' ? 'Incoming' : 'Outgoing'} call` +
          (phoneNumber ? ` — ${phoneNumber}` : '') +
          durationStr +
          `\n\nTranscription:\n${finalTranscript}`;

        if (finalSummary) content += `\n\nSummary:\n${finalSummary}`;
        if (finalSentiment) content += `\n\nSentiment: ${finalSentiment}`;

        let message;
        if (existing?.messageId) {
          message = await prisma.message.update({
            where: { id: existing.messageId },
            data: { content, metadata: { callRecordingId: callRecording.id, bitrixActivityId: activityId } },
          });
        } else {
          message = await prisma.message.create({
            data: {
              leadId: lead.id,
              agentId: agent.id,
              content,
              type: 'call_transcript',
              source: 'bitrix24',
              direction,
              metadata: {
                callRecordingId: callRecording.id,
                bitrixActivityId: activityId,
                phoneNumber,
                duration,
              },
            },
          });
          await prisma.callRecording.update({
            where: { id: callRecording.id },
            data: { messageId: message.id },
          });
        }

        // Embed in Qdrant
        try {
          if (existing?.embeddingId) {
            await qdrantService.deleteVector(existing.embeddingId).catch(() => {});
          }

          const embedding = await embeddingService.generateEmbedding(content);
          const vectorId = uuidv4();

          await qdrantService.upsertVector({
            id: vectorId,
            vector: embedding,
            payload: {
              agent_id: agent.id,
              lead_id: lead.id,
              message_id: message.id,
              type: 'call_transcript',
              content,
              timestamp: activity.CREATED || new Date().toISOString(),
              metadata: { source: 'bitrix24', direction, phoneNumber, callRecordingId: callRecording.id },
            },
          });

          await prisma.message.update({ where: { id: message.id }, data: { isEmbedded: true, embeddingId: vectorId } });
          await prisma.callRecording.update({ where: { id: callRecording.id }, data: { isEmbedded: true, embeddingId: vectorId } });

          logger.info(`Embedded transcript for activity ${activityId}`);
        } catch (embedErr: any) {
          logger.error(`Failed to embed transcript for activity ${activityId}: ${embedErr.message}`);
        }

        // ── Post to Bitrix24 timeline (once per call) ─────────────────────
        // Re-fetch from DB to avoid race condition where two concurrent webhook
        // events (OnCrmActivityAdd + OnCrmActivityUpdate) both see stale metadata
        const latestCallRec = await prisma.callRecording.findUnique({ where: { id: callRecording.id } });
        if (activity.OWNER_ID && !(latestCallRec?.metadata as any)?.bitrixTimelineCommentId) {
          const commentId = await this.saveToBitrix24Timeline({
            ownerId: String(activity.OWNER_ID),
            ownerTypeId: String(activity.OWNER_TYPE_ID || '1'),
            transcript: finalTranscript,
            summary: finalSummary,
            sentiment: finalSentiment,
            direction,
            phoneNumber,
            duration,
          });
          if (commentId) {
            await prisma.callRecording.update({
              where: { id: callRecording.id },
              data: {
                metadata: {
                  ...(latestCallRec?.metadata as object || {}),
                  bitrixTimelineCommentId: commentId,
                },
              },
            });
          }
        }
      }

      await prisma.webhookLog.update({ where: { id: webhookLog.id }, data: { processed: true } });
      logger.info(`Activity ${activityId} done — lead=${lead.id}, agent=${agent.id}, transcribed=${!!finalTranscript}`);

      return {
        success: true,
        callRecordingId: callRecording.id,
        leadId: lead.id,
        transcribed: !!finalTranscript,
      };
    } catch (err: any) {
      logger.error('Failed to process Bitrix24 activity:', err.message);
      await prisma.webhookLog.update({
        where: { id: webhookLog.id },
        data: { errorMessage: err.message },
      });
      throw err;
    }
  }

  // ─── Retry Failed Call Transcriptions ────────────────────────────────────
  // Called by scheduler for call_recordings where Whisper failed on the first attempt.
  // Re-fetches activity from Bitrix24 (to get a fresh DOWNLOAD_URL) then re-transcribes.

  async retryCallTranscriptions(lookbackDays: number): Promise<{ retried: number; succeeded: number; failed: number }> {
    const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const failedCalls = await prisma.callRecording.findMany({
      where: {
        isTranscribed: false,
        audioUrl: { not: null },
        bitrixActivityId: { not: null },
        createdAt: { gte: cutoff },
      },
    });

    if (failedCalls.length === 0) return { retried: 0, succeeded: 0, failed: 0 };

    logger.info(`Call transcription retry: ${failedCalls.length} candidate(s)`);

    let succeeded = 0;
    let failed = 0;

    for (const callRec of failedCalls) {
      if (!callRec.leadId) {
        logger.warn(`Retry skipped for call_recording ${callRec.id}: no lead associated`);
        failed++;
        continue;
      }

      try {
        // Re-fetch activity to get a fresh disk file ID (download URLs expire)
        const activity = await this.fetchActivity(callRec.bitrixActivityId!);
        const files: any[] = activity.FILES || [];
        const audioFile = files[0];
        if (!audioFile) {
          logger.warn(`Retry: no audio file on activity ${callRec.bitrixActivityId}`);
          failed++;
          continue;
        }

        const authToken = this.extractAuthToken();
        const audioUrl = `${audioFile.url}${authToken}`;

        const transcriptText = await this.transcribeAudio(audioFile, audioUrl);
        if (!transcriptText) {
          logger.warn(`Retry: transcription still failed for call_recording ${callRec.id}`);
          failed++;
          continue;
        }

        const { summary: summaryText, sentiment } = await this.generateCallInsights(transcriptText);

        await prisma.callRecording.update({
          where: { id: callRec.id },
          data: { transcriptText, summaryText, sentiment, isTranscribed: true },
        });

        // Build embedded content string
        const durationStr = callRec.duration !== null
          ? ` (${Math.floor(callRec.duration! / 60)}m ${callRec.duration! % 60}s)`
          : '';
        let content =
          `${callRec.direction === 'inbound' ? 'Incoming' : 'Outgoing'} call` +
          (callRec.phoneNumber !== 'unknown' ? ` — ${callRec.phoneNumber}` : '') +
          durationStr +
          `\n\nTranscription:\n${transcriptText}`;
        if (summaryText) content += `\n\nSummary:\n${summaryText}`;
        if (sentiment) content += `\n\nSentiment: ${sentiment}`;

        // Create or update the linked message
        let message;
        if (callRec.messageId) {
          message = await prisma.message.update({
            where: { id: callRec.messageId },
            data: { content },
          });
        } else {
          message = await prisma.message.create({
            data: {
              leadId: callRec.leadId,
              agentId: callRec.agentId,
              content,
              type: 'call_transcript',
              source: 'bitrix24',
              direction: callRec.direction,
              metadata: {
                callRecordingId: callRec.id,
                bitrixActivityId: callRec.bitrixActivityId,
                phoneNumber: callRec.phoneNumber,
                duration: callRec.duration,
                retried: true,
              },
            },
          });
          await prisma.callRecording.update({
            where: { id: callRec.id },
            data: { messageId: message.id },
          });
        }

        // Embed in Qdrant (replace stale vector if present)
        if (callRec.embeddingId) {
          await qdrantService.deleteVector(callRec.embeddingId).catch(() => {});
        }
        const embedding = await embeddingService.generateEmbedding(content);
        const vectorId = uuidv4();

        await qdrantService.upsertVector({
          id: vectorId,
          vector: embedding,
          payload: {
            agent_id: callRec.agentId,
            lead_id: callRec.leadId,
            message_id: message.id,
            type: 'call_transcript',
            content,
            timestamp: callRec.createdAt.toISOString(),
            metadata: {
              source: 'bitrix24',
              direction: callRec.direction,
              phoneNumber: callRec.phoneNumber,
              callRecordingId: callRec.id,
            },
          },
        });

        await prisma.message.update({ where: { id: message.id }, data: { isEmbedded: true, embeddingId: vectorId } });
        await prisma.callRecording.update({ where: { id: callRec.id }, data: { isEmbedded: true, embeddingId: vectorId } });

        // ── Post to Bitrix24 timeline (once per call) ─────────────────────
        // Re-fetch from DB to get current state and avoid duplicate posts
        const latestCallRec = await prisma.callRecording.findUnique({ where: { id: callRec.id } });
        if (activity.OWNER_ID && !(latestCallRec?.metadata as any)?.bitrixTimelineCommentId) {
          const commentId = await this.saveToBitrix24Timeline({
            ownerId: String(activity.OWNER_ID),
            ownerTypeId: String(activity.OWNER_TYPE_ID || '1'),
            transcript: transcriptText,
            summary: summaryText,
            sentiment,
            direction: callRec.direction,
            phoneNumber: callRec.phoneNumber !== 'unknown' ? callRec.phoneNumber : null,
            duration: callRec.duration,
          });
          if (commentId) {
            await prisma.callRecording.update({
              where: { id: callRec.id },
              data: {
                metadata: {
                  ...(latestCallRec?.metadata as object || {}),
                  bitrixTimelineCommentId: commentId,
                },
              },
            });
          }
        }

        logger.info(`Retry call transcription succeeded for call_recording ${callRec.id}`);
        succeeded++;
      } catch (err: any) {
        logger.error(`Retry call transcription error for call_recording ${callRec.id}: ${err.message}`);
        failed++;
      }
    }

    return { retried: failedCalls.length, succeeded, failed };
  }

  // ─── Generic message processor (used by sync routes) ─────────────────────

  async processMessage(params: {
    leadId: string;
    agentId: string;
    content: string;
    type?: string;
    timestamp?: Date;
    bitrixCommentId?: string;
    metadata?: any;
  }) {
    const { leadId, agentId, content, type = 'comment', timestamp = new Date(), bitrixCommentId, metadata = {} } = params;

    const message = await prisma.message.create({
      data: {
        leadId,
        agentId,
        content,
        type,
        source: metadata.source || 'bitrix24',
        direction: metadata.direction || 'inbound',
        bitrixCommentId,
        metadata,
        createdAt: timestamp,
      },
    });

    const embedding = await embeddingService.generateEmbedding(content);
    const vectorId = uuidv4();

    await qdrantService.upsertVector({
      id: vectorId,
      vector: embedding,
      payload: {
        agent_id: agentId,
        lead_id: leadId,
        message_id: message.id,
        type,
        content,
        timestamp: timestamp.toISOString(),
        metadata,
      },
    });

    await prisma.message.update({
      where: { id: message.id },
      data: { isEmbedded: true, embeddingId: vectorId },
    });

    return { success: true, messageId: message.id, leadId };
  }
}

export const webhookService = new WebhookService();
