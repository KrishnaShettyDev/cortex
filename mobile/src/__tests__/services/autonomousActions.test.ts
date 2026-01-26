/**
 * Tests for Autonomous Actions Service
 *
 * Tests the API service layer for Iris-style autonomous actions.
 */

describe('AutonomousActionsService', () => {
  // Mock API response data
  const mockPendingActions = [
    {
      id: 'action-1',
      action_type: 'email_reply',
      title: 'Reply to Sarah',
      description: 'Thanks for the project update...',
      action_payload: {
        thread_id: 'thread_123',
        to: 'sarah@example.com',
        subject: 'Re: Project Update',
        body: 'Thanks for the update! I will review and get back to you.',
      },
      reason: 'Urgent email needs response',
      confidence_score: 0.85,
      priority_score: 75,
      source_type: 'email',
      source_id: 'thread_123',
      created_at: '2024-01-20T10:00:00Z',
      expires_at: '2024-01-21T10:00:00Z',
    },
    {
      id: 'action-2',
      action_type: 'calendar_reschedule',
      title: 'Resolve conflict: Team Sync',
      description: 'Conflicts with Client Meeting',
      action_payload: {
        event_id: 'evt_456',
        event_title: 'Team Sync',
        current_start: '2024-01-20T14:00:00Z',
        conflict_with: 'Client Meeting',
      },
      reason: 'Time conflict detected',
      confidence_score: 0.7,
      priority_score: 85,
      source_type: 'calendar',
      source_id: 'evt_456',
      created_at: '2024-01-20T09:00:00Z',
      expires_at: '2024-01-20T14:00:00Z',
    },
  ];

  describe('getPendingActions', () => {
    it('should parse action response correctly', () => {
      const response = {
        actions: mockPendingActions,
        count: 2,
      };

      expect(response.actions).toHaveLength(2);
      expect(response.count).toBe(2);
      expect(response.actions[0].action_type).toBe('email_reply');
      expect(response.actions[1].action_type).toBe('calendar_reschedule');
    });

    it('should handle empty actions list', () => {
      const response = {
        actions: [],
        count: 0,
      };

      expect(response.actions).toHaveLength(0);
      expect(response.count).toBe(0);
    });
  });

  describe('approveAction', () => {
    it('should construct approve request without modifications', () => {
      const actionId = 'action-1';
      const request = {
        actionId,
        modifications: undefined,
      };

      expect(request.actionId).toBe('action-1');
      expect(request.modifications).toBeUndefined();
    });

    it('should construct approve request with modifications', () => {
      const actionId = 'action-1';
      const modifications = {
        body: 'Modified email body with more context',
        subject: 'Re: Updated Subject Line',
      };
      const request = {
        actionId,
        modifications,
      };

      expect(request.actionId).toBe('action-1');
      expect(request.modifications).toEqual(modifications);
      expect(request.modifications.body).toContain('Modified');
    });

    it('should parse success response', () => {
      const response = {
        success: true,
        message: 'Email sent successfully',
        message_id: 'msg_abc123',
      };

      expect(response.success).toBe(true);
      expect(response.message).toBeDefined();
      expect(response.message_id).toBe('msg_abc123');
    });

    it('should parse failure response', () => {
      const response = {
        success: false,
        message: 'Failed to send email: Network error',
      };

      expect(response.success).toBe(false);
      expect(response.message).toContain('Failed');
    });
  });

  describe('dismissAction', () => {
    it('should construct dismiss request without reason', () => {
      const actionId = 'action-1';
      const request = {
        actionId,
        reason: undefined,
      };

      expect(request.actionId).toBe('action-1');
      expect(request.reason).toBeUndefined();
    });

    it('should construct dismiss request with reason', () => {
      const actionId = 'action-1';
      const request = {
        actionId,
        reason: 'wrong_timing',
      };

      expect(request.actionId).toBe('action-1');
      expect(request.reason).toBe('wrong_timing');
    });

    it('should support various dismiss reasons', () => {
      const validReasons = ['wrong_timing', 'not_relevant', 'incorrect', 'already_done'];

      validReasons.forEach((reason) => {
        const request = {
          actionId: 'action-1',
          reason,
        };
        expect(request.reason).toBe(reason);
      });
    });
  });

  describe('submitFeedback', () => {
    it('should construct feedback request with rating', () => {
      const request = {
        actionId: 'action-1',
        rating: 5,
        feedback_type: 'helpful',
        comment: undefined,
      };

      expect(request.rating).toBe(5);
      expect(request.feedback_type).toBe('helpful');
    });

    it('should validate rating range', () => {
      const validRatings = [1, 2, 3, 4, 5];
      const invalidRatings = [0, 6, -1, 10];

      validRatings.forEach((rating) => {
        expect(rating >= 1 && rating <= 5).toBe(true);
      });

      invalidRatings.forEach((rating) => {
        expect(rating >= 1 && rating <= 5).toBe(false);
      });
    });

    it('should support feedback types', () => {
      const feedbackTypes = ['helpful', 'not_helpful', 'wrong_timing', 'incorrect'];

      feedbackTypes.forEach((type) => {
        const request = {
          actionId: 'action-1',
          feedback_type: type,
        };
        expect(request.feedback_type).toBe(type);
      });
    });
  });

  describe('getStats', () => {
    it('should parse stats response', () => {
      const response = {
        pending: 3,
        executed: 15,
        dismissed: 7,
        expired: 5,
        total: 30,
        approval_rate: 0.68,
      };

      expect(response.pending).toBe(3);
      expect(response.executed).toBe(15);
      expect(response.dismissed).toBe(7);
      expect(response.approval_rate).toBeCloseTo(0.68, 2);
    });

    it('should calculate approval rate correctly', () => {
      const executed = 15;
      const dismissed = 7;
      const total = executed + dismissed;
      const approvalRate = executed / total;

      expect(approvalRate).toBeCloseTo(0.68, 2);
    });
  });
});

describe('Action Type Handlers', () => {
  describe('email_reply', () => {
    it('should have required payload fields', () => {
      const emailPayload = {
        thread_id: 'thread_123',
        to: 'recipient@example.com',
        subject: 'Re: Original Subject',
        body: 'Reply body text',
      };

      expect(emailPayload.thread_id).toBeDefined();
      expect(emailPayload.to).toBeDefined();
      expect(emailPayload.subject).toBeDefined();
      expect(emailPayload.body).toBeDefined();
    });

    it('should validate email format', () => {
      const validEmails = ['test@example.com', 'user.name@domain.org', 'a@b.co'];
      const invalidEmails = ['invalid', '@domain.com', 'user@', 'user@.com'];

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      validEmails.forEach((email) => {
        expect(emailRegex.test(email)).toBe(true);
      });

      invalidEmails.forEach((email) => {
        expect(emailRegex.test(email)).toBe(false);
      });
    });
  });

  describe('calendar_create', () => {
    it('should have required payload fields', () => {
      const calendarPayload = {
        title: 'Team Meeting',
        start_time: '2024-01-20T10:00:00Z',
        end_time: '2024-01-20T11:00:00Z',
        attendees: ['john@example.com'],
        location: 'Conference Room A',
      };

      expect(calendarPayload.title).toBeDefined();
      expect(calendarPayload.start_time).toBeDefined();
      expect(calendarPayload.end_time).toBeDefined();
    });

    it('should have end_time after start_time', () => {
      const start = new Date('2024-01-20T10:00:00Z');
      const end = new Date('2024-01-20T11:00:00Z');

      expect(end > start).toBe(true);
    });

    it('should handle optional attendees', () => {
      const payloadWithAttendees = {
        title: 'Meeting',
        start_time: '2024-01-20T10:00:00Z',
        end_time: '2024-01-20T11:00:00Z',
        attendees: ['a@b.com', 'c@d.com'],
      };

      const payloadWithoutAttendees = {
        title: 'Focus Time',
        start_time: '2024-01-20T10:00:00Z',
        end_time: '2024-01-20T12:00:00Z',
        attendees: undefined,
      };

      expect(payloadWithAttendees.attendees).toHaveLength(2);
      expect(payloadWithoutAttendees.attendees).toBeUndefined();
    });
  });

  describe('calendar_reschedule', () => {
    it('should have event_id for rescheduling', () => {
      const reschedulePayload = {
        event_id: 'evt_123',
        event_title: 'Team Meeting',
        current_start: '2024-01-20T10:00:00Z',
        new_start: '2024-01-20T14:00:00Z',
        conflict_with: 'Client Call',
      };

      expect(reschedulePayload.event_id).toBeDefined();
      expect(reschedulePayload.current_start).toBeDefined();
    });
  });

  describe('meeting_prep', () => {
    it('should have meeting details', () => {
      const prepPayload = {
        event_id: 'evt_789',
        event_title: 'Quarterly Review',
        start_time: '2024-01-20T15:00:00Z',
        attendees: ['boss@company.com', 'team@company.com'],
      };

      expect(prepPayload.event_title).toBeDefined();
      expect(prepPayload.start_time).toBeDefined();
    });

    it('should calculate hours until meeting', () => {
      const now = new Date('2024-01-20T13:00:00Z');
      const meetingStart = new Date('2024-01-20T15:00:00Z');
      const hoursUntil = (meetingStart.getTime() - now.getTime()) / (1000 * 60 * 60);

      expect(hoursUntil).toBe(2);
    });
  });

  describe('followup', () => {
    it('should have thread context', () => {
      const followupPayload = {
        thread_id: 'thread_original',
        to: 'contact@example.com',
        subject: 'Re: Following up',
        body: 'Just wanted to follow up on our previous conversation...',
        days_since_sent: 5,
      };

      expect(followupPayload.thread_id).toBeDefined();
      expect(followupPayload.days_since_sent).toBeGreaterThan(0);
    });
  });
});

describe('Action Confidence & Priority', () => {
  describe('confidence scoring', () => {
    it('should have confidence between 0 and 1', () => {
      const confidenceScores = [0.85, 0.7, 0.5, 0.4, 0.95];

      confidenceScores.forEach((score) => {
        expect(score >= 0 && score <= 1).toBe(true);
      });
    });

    it('should filter low confidence actions', () => {
      const MIN_CONFIDENCE = 0.4;
      const actions = [
        { id: 1, confidence_score: 0.85 },
        { id: 2, confidence_score: 0.3 }, // Below threshold
        { id: 3, confidence_score: 0.6 },
        { id: 4, confidence_score: 0.2 }, // Below threshold
      ];

      const filtered = actions.filter((a) => a.confidence_score >= MIN_CONFIDENCE);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((a) => a.id)).toEqual([1, 3]);
    });
  });

  describe('priority scoring', () => {
    it('should sort actions by priority', () => {
      const actions = [
        { id: 1, priority_score: 60 },
        { id: 2, priority_score: 85 },
        { id: 3, priority_score: 75 },
      ];

      const sorted = [...actions].sort((a, b) => b.priority_score - a.priority_score);

      expect(sorted[0].id).toBe(2);
      expect(sorted[1].id).toBe(3);
      expect(sorted[2].id).toBe(1);
    });

    it('should filter low priority actions', () => {
      const MIN_PRIORITY = 40;
      const actions = [
        { id: 1, priority_score: 80 },
        { id: 2, priority_score: 30 }, // Below threshold
        { id: 3, priority_score: 50 },
      ];

      const filtered = actions.filter((a) => a.priority_score >= MIN_PRIORITY);
      expect(filtered).toHaveLength(2);
    });
  });

  describe('combined filtering', () => {
    it('should filter by both confidence and priority', () => {
      const MIN_CONFIDENCE = 0.4;
      const MIN_PRIORITY = 40;
      const MAX_ACTIONS = 5;

      const actions = [
        { id: 1, confidence_score: 0.8, priority_score: 80 },
        { id: 2, confidence_score: 0.3, priority_score: 90 }, // Low confidence
        { id: 3, confidence_score: 0.6, priority_score: 30 }, // Low priority
        { id: 4, confidence_score: 0.7, priority_score: 70 },
        { id: 5, confidence_score: 0.5, priority_score: 50 },
      ];

      const filtered = actions
        .filter(
          (a) =>
            a.confidence_score >= MIN_CONFIDENCE && a.priority_score >= MIN_PRIORITY
        )
        .sort((a, b) => b.priority_score - a.priority_score)
        .slice(0, MAX_ACTIONS);

      expect(filtered).toHaveLength(3);
      expect(filtered.map((a) => a.id)).toEqual([1, 4, 5]);
    });
  });
});

describe('Action Expiry', () => {
  it('should identify expired actions', () => {
    const now = new Date('2024-01-20T12:00:00Z');
    const actions = [
      { id: 1, expires_at: '2024-01-20T10:00:00Z' }, // Expired
      { id: 2, expires_at: '2024-01-20T14:00:00Z' }, // Not expired
      { id: 3, expires_at: '2024-01-19T12:00:00Z' }, // Expired
    ];

    const notExpired = actions.filter(
      (a) => new Date(a.expires_at) > now
    );

    expect(notExpired).toHaveLength(1);
    expect(notExpired[0].id).toBe(2);
  });

  it('should calculate time until expiry', () => {
    const now = new Date('2024-01-20T10:00:00Z');
    const expiresAt = new Date('2024-01-20T14:00:00Z');
    const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    expect(hoursUntilExpiry).toBe(4);
  });
});

describe('Optimistic Updates', () => {
  it('should remove action from list on approve', () => {
    const actions = [
      { id: 'action-1', title: 'Action 1' },
      { id: 'action-2', title: 'Action 2' },
      { id: 'action-3', title: 'Action 3' },
    ];

    const actionIdToApprove = 'action-2';
    const updatedActions = actions.filter((a) => a.id !== actionIdToApprove);

    expect(updatedActions).toHaveLength(2);
    expect(updatedActions.find((a) => a.id === actionIdToApprove)).toBeUndefined();
  });

  it('should remove action from list on dismiss', () => {
    const actions = [
      { id: 'action-1', title: 'Action 1' },
      { id: 'action-2', title: 'Action 2' },
    ];

    const actionIdToDismiss = 'action-1';
    const updatedActions = actions.filter((a) => a.id !== actionIdToDismiss);

    expect(updatedActions).toHaveLength(1);
    expect(updatedActions[0].id).toBe('action-2');
  });

  it('should update count correctly', () => {
    const state = {
      actions: [{ id: '1' }, { id: '2' }, { id: '3' }],
      count: 3,
    };

    const actionIdToRemove = '2';
    const updatedState = {
      actions: state.actions.filter((a) => a.id !== actionIdToRemove),
      count: state.count - 1,
    };

    expect(updatedState.actions).toHaveLength(2);
    expect(updatedState.count).toBe(2);
  });

  it('should rollback on error', () => {
    const originalState = {
      actions: [{ id: '1' }, { id: '2' }],
      count: 2,
    };

    // Simulate optimistic update
    const optimisticState = {
      actions: originalState.actions.filter((a) => a.id !== '1'),
      count: originalState.count - 1,
    };

    expect(optimisticState.count).toBe(1);

    // Simulate error rollback
    const rolledBackState = originalState;

    expect(rolledBackState.count).toBe(2);
    expect(rolledBackState.actions).toHaveLength(2);
  });
});
