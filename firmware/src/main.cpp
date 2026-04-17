#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include "config.h"

// ESP32-C3 использует компактный бинарный протокол (46 байт)
// Остальные платы пока на JSON
#ifndef BOARD_ESP32_C3_MUX
  #include <ArduinoJson.h>
#endif

// ===== МУЛЬТИПЛЕКСОР =====
#ifdef BOARD_ESP32_C3_MUX
  const int MUX_SELECT_PINS[4] = { MUX_S0_PIN, MUX_S1_PIN, MUX_S2_PIN, MUX_S3_PIN };
  const int MUX_FLEX_CH[5] = MUX_FLEX_CHANNELS;

  void muxSelectChannel(int channel) {
    for (int i = 0; i < 4; i++) {
      digitalWrite(MUX_SELECT_PINS[i], (channel >> i) & 1);
    }
    delayMicroseconds(100); // ждём переключение мультиплексора + заряд конденсатора АЦП
  }

  int muxAnalogRead(int channel) {
    muxSelectChannel(channel);
    analogRead(MUX_SIG_PIN); // холостое чтение 1
    delayMicroseconds(100);
    analogRead(MUX_SIG_PIN); // холостое чтение 2
    delayMicroseconds(100);
    return analogRead(MUX_SIG_PIN); // реальное чтение
  }

  bool muxDigitalRead(int channel) {
    muxSelectChannel(channel);
    analogRead(MUX_SIG_PIN);
    delayMicroseconds(100);
    analogRead(MUX_SIG_PIN);
    delayMicroseconds(100);
    return analogRead(MUX_SIG_PIN) < MUX_DIGITAL_THRESHOLD;
  }
#endif

// ===== ПИНЫ =====
#ifndef BOARD_ESP32_C3_MUX
  const int FLEX_PINS[5] = {
    FLEX_THUMB_PIN, FLEX_INDEX_PIN, FLEX_MIDDLE_PIN, FLEX_RING_PIN, FLEX_PINKY_PIN
  };
#endif

// ===== КАЛИБРОВКА =====
int flexMin[5] = { FLEX_THUMB_MIN, FLEX_INDEX_MIN, FLEX_MIDDLE_MIN, FLEX_RING_MIN, FLEX_PINKY_MIN };
int flexMax[5] = { FLEX_THUMB_MAX, FLEX_INDEX_MAX, FLEX_MIDDLE_MAX, FLEX_RING_MAX, FLEX_PINKY_MAX };

// ===== СЕТЬ =====
WiFiUDP udpData;
WiFiUDP udpDiscovery;

String macAddress;
IPAddress serverIP;
int serverDataPort = UVRA_DATA_PORT;
bool serverFound = false;
unsigned long lastDiscovery = 0;

// ===== ФУНКЦИИ =====

String getMacAddress() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char buf[18];
  snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

float mapFlex(int raw, int minVal, int maxVal) {
  float val = (float)(raw - minVal) / (float)(maxVal - minVal);
  return constrain(val, 0.0f, 1.0f);
}

void sendDiscovery() {
  // Отправляем broadcast-пакет для обнаружения UVRA на всех машинах в сети
  String packet = "UVRA_DISCOVER:" + macAddress;

  udpDiscovery.beginPacket(IPAddress(255, 255, 255, 255), UVRA_DISCOVERY_PORT);
  udpDiscovery.write((const uint8_t*)packet.c_str(), packet.length());
  udpDiscovery.endPacket();
}

void checkDiscoveryResponse() {
  int packetSize = udpDiscovery.parsePacket();
  if (packetSize > 0) {
    char buf[64];
    int len = udpDiscovery.read(buf, sizeof(buf) - 1);
    buf[len] = '\0';

    String response = String(buf);
    // Ожидаем ответ формата: "UVRA_ACK:<dataPort>"
    if (response.startsWith("UVRA_ACK:")) {
      serverIP = udpDiscovery.remoteIP();
      serverDataPort = response.substring(9).toInt();
      if (serverDataPort <= 0) serverDataPort = UVRA_DATA_PORT;
      serverFound = true;

      Serial.print("Server found: ");
      Serial.print(serverIP);
      Serial.print(":");
      Serial.println(serverDataPort);
    }
  }
}

void setup() {
  Serial.begin(115200);

  // Настройка пинов
#ifdef BOARD_ESP32_C3_MUX
  // Мультиплексор: SIG как вход, S0-S3 как выходы
  pinMode(MUX_SIG_PIN, INPUT);
  for (int i = 0; i < 4; i++) {
    pinMode(MUX_SELECT_PINS[i], OUTPUT);
    digitalWrite(MUX_SELECT_PINS[i], LOW);
  }
#else
  for (int i = 0; i < 5; i++) {
    pinMode(FLEX_PINS[i], INPUT);
  }
  pinMode(JOY_X_PIN, INPUT);
  pinMode(JOY_Y_PIN, INPUT);
  pinMode(JOY_BTN_PIN, INPUT_PULLUP);
  pinMode(BTN_A_PIN, INPUT_PULLUP);
  pinMode(BTN_B_PIN, INPUT_PULLUP);
  pinMode(TRIGGER_PIN, INPUT);
#endif

  // Подключение к WiFi
  WiFi.setSleep(false);                 // отключаем modem sleep — стабильное соединение
  WiFi.setTxPower(WIFI_POWER_8_5dBm);  // снижаем мощность передатчика (по умолчанию 20dBm)
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected! IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("TX power: 8.5 dBm, modem sleep: OFF");

  macAddress = getMacAddress();
  Serial.print("MAC: ");
  Serial.println(macAddress);

  // Запускаем UDP сокеты
  udpData.begin(UVRA_DATA_PORT + 1);     // локальный порт для отправки данных
  udpDiscovery.begin(UVRA_DISCOVERY_PORT); // для приёма ответов discovery

  Serial.println("UDP sockets ready. Waiting for UVRA server...");
}

void loop() {
  // === АВТООБНАРУЖЕНИЕ ===
  // Всегда проверяем ответы discovery (даже если сервер уже найден — на случай смены IP)
  checkDiscoveryResponse();

  if (!serverFound || (millis() - lastDiscovery > DISCOVERY_INTERVAL)) {
    sendDiscovery();
    lastDiscovery = millis();
    if (!serverFound) {
      Serial.println("Discovery sent, waiting for UVRA server...");
    }
  }

  // Если сервер не найден, не отправляем данные
  if (!serverFound) {
    delay(100);
    return;
  }

  // === ЧТЕНИЕ ДАТЧИКОВ ===
  int rawFlex[5];
  float flex[5];
  int rawJoyX, rawJoyY, rawTrigger;
  bool joyBtn, btnA, btnB;

#ifdef BOARD_ESP32_C3_MUX
  // Чтение через мультиплексор
  #if HAS_FINGERS
    for (int i = 0; i < 5; i++) {
      rawFlex[i] = muxAnalogRead(MUX_FLEX_CH[i]);
      flex[i] = mapFlex(rawFlex[i], flexMin[i], flexMax[i]);
    }
  #else
    for (int i = 0; i < 5; i++) { rawFlex[i] = 0; flex[i] = 0.0f; }
  #endif

  #if HAS_JOYSTICK
    rawJoyX = muxAnalogRead(MUX_CH_JOY_X);
    rawJoyY = muxAnalogRead(MUX_CH_JOY_Y);
    joyBtn = muxDigitalRead(MUX_CH_JOY_BTN);
  #else
    rawJoyX = 2048; rawJoyY = 2048; joyBtn = false;
  #endif

  #if HAS_BUTTONS
    btnA = muxDigitalRead(MUX_CH_BTN_A);
    btnB = muxDigitalRead(MUX_CH_BTN_B);
  #else
    btnA = false; btnB = false;
  #endif

  #if HAS_TRIGGER
    rawTrigger = muxAnalogRead(MUX_CH_TRIGGER);
  #else
    rawTrigger = 0;
  #endif
#else
  // Прямое чтение с пинов
  for (int i = 0; i < 5; i++) {
    rawFlex[i] = analogRead(FLEX_PINS[i]);
    flex[i] = mapFlex(rawFlex[i], flexMin[i], flexMax[i]);
  }
  rawJoyX = analogRead(JOY_X_PIN);
  rawJoyY = analogRead(JOY_Y_PIN);
  joyBtn = !digitalRead(JOY_BTN_PIN);
  btnA = !digitalRead(BTN_A_PIN);
  btnB = !digitalRead(BTN_B_PIN);
  rawTrigger = analogRead(TRIGGER_PIN);
#endif

  float joyX = (rawJoyX - 2048.0f) / 2048.0f;
  float joyY = (rawJoyY - 2048.0f) / 2048.0f;
  if (INVERT_JOY_X) joyX = -joyX;
  if (INVERT_JOY_Y) joyY = -joyY;

  // Круговая дедзона: значения внутри радиуса JOYSTICK_DEADZONE обнуляются,
  // вне — масштабируются так чтобы выход начинался с 0 у края дедзоны.
  #if JOYSTICK_DEADZONE > 0.0f
  {
    float mag = sqrtf(joyX * joyX + joyY * joyY);
    if (mag < JOYSTICK_DEADZONE) {
      joyX = 0.0f;
      joyY = 0.0f;
    } else {
      float scale = (mag - JOYSTICK_DEADZONE) / ((1.0f - JOYSTICK_DEADZONE) * mag);
      joyX *= scale;
      joyY *= scale;
    }
  }
  #endif

  float trigVal = rawTrigger / 4095.0f;
  bool trigBtn = trigVal > 0.8f;

#ifdef BOARD_ESP32_C3_MUX
  // === ФОРМИРОВАНИЕ БИНАРНОГО ПАКЕТА (UVRA Binary v1) ===
  // Формат:
  //   [0]      0x55 — magic byte
  //   [1]      hand: 0=left, 1=right
  //   [2..18]  MAC: 17 байт "XX:XX:XX:XX:XX:XX\0"
  //   [19..28] raw flex: 5 × uint16_t LE — сырые значения АЦП
  //   [29..38] norm flex: 5 × uint16_t LE (0..10000 → 0.0..1.0)
  //   [39..42] joystick: 2 × int16_t LE (-10000..10000)
  //   [43]     buttons: bitmask
  //   [44..45] trigger: uint16_t LE (0..10000)
  //   Итого: 46 байт (вместо ~400 JSON)

  uint8_t packet[46];
  int pos = 0;

  packet[pos++] = 0x55; // magic

  packet[pos++] = (strcmp(HAND, "left") == 0) ? 0 : 1; // hand

  memcpy(&packet[pos], macAddress.c_str(), 17); // MAC
  pos += 17;

  for (int i = 0; i < 5; i++) { // raw flex (5 × uint16 LE)
    uint16_t val = (uint16_t)constrain(rawFlex[i], 0, 4095);
    packet[pos++] = val & 0xFF;
    packet[pos++] = (val >> 8) & 0xFF;
  }

  for (int i = 0; i < 5; i++) { // norm flex (5 × uint16 LE, 0..10000)
    uint16_t val = (uint16_t)(flex[i] * 10000.0f);
    packet[pos++] = val & 0xFF;
    packet[pos++] = (val >> 8) & 0xFF;
  }

  int16_t jxInt = (int16_t)(joyX * 10000.0f); // joystick X
  packet[pos++] = jxInt & 0xFF;
  packet[pos++] = (jxInt >> 8) & 0xFF;
  int16_t jyInt = (int16_t)(joyY * 10000.0f); // joystick Y
  packet[pos++] = jyInt & 0xFF;
  packet[pos++] = (jyInt >> 8) & 0xFF;

  // buttons bitmask
  bool isGrab = flex[1] > 0.7f && flex[2] > 0.7f && flex[3] > 0.7f && flex[4] > 0.7f;
  bool isPinch = flex[0] > 0.6f && flex[1] > 0.6f;
  uint8_t btnMask = 0;
  if (joyBtn)   btnMask |= 0x01;
  if (trigBtn)  btnMask |= 0x02;
  if (btnA)     btnMask |= 0x04;
  if (btnB)     btnMask |= 0x08;
  if (isGrab)   btnMask |= 0x10;
  if (isPinch)  btnMask |= 0x20;
  packet[pos++] = btnMask;

  uint16_t trgInt = (uint16_t)(trigVal * 10000.0f); // trigger
  packet[pos++] = trgInt & 0xFF;
  packet[pos++] = (trgInt >> 8) & 0xFF;

  // Отправка
  if (udpData.beginPacket(serverIP, serverDataPort)) {
    udpData.write(packet, 46);
    if (!udpData.endPacket()) {
      Serial.println("UDP send failed");
    }
  }

#else
  // === ФОРМИРОВАНИЕ JSON (ESP32 / ESP32-S3) ===
  StaticJsonDocument<768> doc;
  doc["hand"] = HAND;
  doc["mac"] = macAddress;

  JsonObject fingers = doc.createNestedObject("fingers");
  const char* fingerNames[] = {"thumb", "index", "middle", "ring", "pinky"};
  for (int i = 0; i < 5; i++) {
    JsonArray arr = fingers.createNestedArray(fingerNames[i]);
    arr.add(flex[i]); arr.add(flex[i]); arr.add(flex[i]); arr.add(flex[i]);
  }

  JsonArray splay = doc.createNestedArray("splay");
  for (int i = 0; i < 5; i++) splay.add(0.5f);

  JsonObject joy = doc.createNestedObject("joystick");
  joy["x"] = joyX;
  joy["y"] = joyY;

  JsonObject btns = doc.createNestedObject("buttons");
  btns["joy"] = joyBtn;
  btns["trigger"] = trigBtn;
  btns["A"] = btnA;
  btns["B"] = btnB;
  btns["grab"] = flex[1] > 0.7f && flex[2] > 0.7f && flex[3] > 0.7f && flex[4] > 0.7f;
  btns["pinch"] = flex[0] > 0.6f && flex[1] > 0.6f;

  doc["triggerValue"] = trigVal;

  JsonArray raw = doc.createNestedArray("raw");
  for (int i = 0; i < 5; i++) raw.add(rawFlex[i]);
  raw.add(rawJoyX); raw.add(rawJoyY); raw.add(rawTrigger);

  char buffer[600];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));

  if (udpData.beginPacket(serverIP, serverDataPort)) {
    udpData.write((uint8_t*)buffer, len);
    if (!udpData.endPacket()) {
      Serial.printf("UDP send failed, len=%d\n", len);
    }
  }
#endif

  delay(SEND_INTERVAL_MS);
}
