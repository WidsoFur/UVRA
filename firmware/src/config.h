#pragma once

// ===== НАСТРОЙКИ WiFi =====
#define WIFI_SSID     "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// ===== НАСТРОЙКИ UVRA =====
// Порт для отправки данных (должен совпадать с портом в приложении UVRA)
#define UVRA_DATA_PORT     7777
// Порт для автообнаружения (discovery)
#define UVRA_DISCOVERY_PORT 7776
// Интервал отправки discovery-запросов (мс)
#define DISCOVERY_INTERVAL  2000
// Рука: "left" или "right"
#define HAND               "left"

// ===== ПИНЫ ДАТЧИКОВ =====
#define FLEX_THUMB_PIN   36
#define FLEX_INDEX_PIN   39
#define FLEX_MIDDLE_PIN  34
#define FLEX_RING_PIN    35
#define FLEX_PINKY_PIN   32

#define JOY_X_PIN        33
#define JOY_Y_PIN        25
#define JOY_BTN_PIN      26

#define BTN_A_PIN        27
#define BTN_B_PIN        14
#define TRIGGER_PIN      12

// ===== КАЛИБРОВКА =====
// Минимальные значения АЦП для каждого пальца (палец разогнут)
#define FLEX_THUMB_MIN   0
#define FLEX_INDEX_MIN   0
#define FLEX_MIDDLE_MIN  0
#define FLEX_RING_MIN    0
#define FLEX_PINKY_MIN   0

// Максимальные значения АЦП для каждого пальца (палец согнут)
#define FLEX_THUMB_MAX   4095
#define FLEX_INDEX_MAX   4095
#define FLEX_MIDDLE_MAX  4095
#define FLEX_RING_MAX    4095
#define FLEX_PINKY_MAX   4095

// ===== ЧАСТОТА ОТПРАВКИ =====
// Задержка между отправками данных (мс). 10 = ~100 Гц
#define SEND_INTERVAL_MS 10
