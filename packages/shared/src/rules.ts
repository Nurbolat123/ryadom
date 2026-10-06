/**
 * Константы из «Принципов безопасности» CLAUDE.md.
 * Меняются только вместе с документом.
 */
export const RULES = {
  /** Правило 3: присутствие в заведении живёт не дольше 2 часов. */
  presenceTtlSeconds: 2 * 60 * 60,
  /** Правило 5: анонимная симпатия уведомляется, только если открыты к знакомству ≥ 3 человек. */
  minOpenPeopleForAnonymousNotice: 3,
  /** Правило 5: случайная задержка анонимного уведомления, секунды. */
  anonymousNoticeDelaySeconds: { min: 60, max: 600 },
  /** «Где знакомятся сейчас»: значения меньше 3 не показываем. */
  minActivityToShow: 3,
  /** Правило 8: лимиты подарков. */
  giftsPerRecipientPerVisit: 1,
  giftsPerSenderPerDay: 3,
  /** Подарок истекает через 2 часа. */
  giftTtlSeconds: 2 * 60 * 60,
  /** Симпатия живёт 24 часа после окончания визита. */
  sympathyTtlAfterVisitSeconds: 24 * 60 * 60,
  /** Регистрация с 18 лет (правило 10). */
  minAge: 18,
  /** Чек-ин: точность GPS хуже 50 м — просим повторить. */
  maxGpsAccuracyMeters: 50,
  /** Геозона по умолчанию — круг 35 м. */
  defaultGeofenceRadiusMeters: 35,
  /** Сколько ближайших заведений показывать на выбор. */
  maxVenueCandidates: 5,
  /** Суперприветов за визит. */
  superHellosPerVisit: 3,
  /** Бесплатных приветов в день без «Плюс». */
  freeHellosPerDay: 5,
  /** Код входа: 6 цифр, живёт 5 минут, не больше 5 попыток ввода. */
  otpTtlSeconds: 5 * 60,
  otpMaxAttempts: 5,
  /** Повторная отправка кода — не чаще раза в минуту, не больше 5 в час на номер и 20 в час с IP. */
  otpResendCooldownSeconds: 60,
  otpPerPhonePerHour: 5,
  otpPerIpPerHour: 20,
  /** Если человеку нет 18, номер блокируется для регистрации на 30 дней. */
  underageBlockSeconds: 30 * 24 * 60 * 60,
  /** Приветов в день с «Плюс» (точные лимиты тарифов — этап 9). */
  plusHellosPerDay: 30,
  /** Суперприветов при регистрации. */
  freeSuperHellosOnSignup: 1,
  /** Rate limits: симпатии и сообщения чата. */
  sympathiesPerHour: 60,
  messagesPerMinute: 30,
  /** Жалоб в сутки от одного человека (rate limit). */
  reportsPerDay: 10,
  /** Как часто realtime проверяет очередь анонимных уведомлений. */
  noticeTickSeconds: 15,
  /** Интересов на человека. */
  maxInterestsPerUser: 10,
} as const;

export const TEXT_LIMITS = {
  about: 120,
  hello: 100,
  superHello: 200,
  message: 2000,
  reportComment: 500,
} as const;
