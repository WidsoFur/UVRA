#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <ArduinoJson.h>
#include "config.h"

// ===== ПИНЫ =====
const int FLEX_PINS[5] = {
  FLEX_THUMB_PIN, FLEX_INDEX_PIN, FLEX_MIDDLE_PIN, FLEX_RING_PIN, FLEX_PINKY_PIN
};

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
  for (int i = 0; i < 5; i++) {
    pinMode(FLEX_PINS[i], INPUT);
  }
  pinMode(JOY_X_PIN, INPUT);
  pinMode(JOY_Y_PIN, INPUT);
  pinMode(JOY_BTN_PIN, INPUT_PULLUP);
  pinMode(BTN_A_PIN, INPUT_PULLUP);
  pinMode(BTN_B_PIN, INPUT_PULLUP);
  pinMode(TRIGGER_PIN, INPUT);

  // Подключение к WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected! IP: ");
  Serial.println(WiFi.localIP());

  macAddress = getMacAddress();
  Serial.print("MAC: ");
  Serial.println(macAddress);

  // Запускаем UDP сокеты
  udpData.begin(UVRA_DATA_PORT + 1);     // локальный порт для отправки данных
  udpDiscovery.begin(UVRA_DISCOVERY_PORT); // для приёма ответов discovery
}

void loop() {
  // === АВТООБНАРУЖЕНИЕ ===
  // Всегда проверяем ответы discovery (даже если сервер уже найден — на случай смены IP)
  checkDiscoveryResponse();

  if (!serverFound || (millis() - lastDiscovery > DISCOVERY_INTERVAL)) {
    sendDiscovery();
    lastDiscovery = millis();
  }

  // Если сервер не найден, не отправляем данные
  if (!serverFound) {
    delay(100);
    return;
  }

  // === ЧТЕНИЕ ДАТЧИКОВ ===
  float flex[5];
  for (int i = 0; i < 5; i++) {
    int raw = analogRead(FLEX_PINS[i]);
    flex[i] = mapFlex(raw, flexMin[i], flexMax[i]);
  }

  float joyX = (analogRead(JOY_X_PIN) - 2048.0f) / 2048.0f;
  float joyY = (analogRead(JOY_Y_PIN) - 2048.0f) / 2048.0f;
  bool joyBtn = !digitalRead(JOY_BTN_PIN);

  bool btnA = !digitalRead(BTN_A_PIN);
  bool btnB = !digitalRead(BTN_B_PIN);
  float trigVal = analogRead(TRIGGER_PIN) / 4095.0f;
  bool trigBtn = trigVal > 0.8f;

  // === ФОРМИРОВАНИЕ JSON ===
  StaticJsonDocument<512> doc;
  doc["hand"] = HAND;
  doc["mac"] = macAddress;

  JsonObject fingers = doc.createNestedObject("fingers");
  const char* fingerNames[] = {"thumb", "index", "middle", "ring", "pinky"};
  for (int i = 0; i < 5; i++) {
    JsonArray arr = fingers.createNestedArray(fingerNames[i]);
    arr.add(0.0f);
    arr.add(flex[i]);
    arr.add(flex[i]);
    arr.add(i == 0 ? 0.0f : flex[i]);
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

  // === ОТПРАВКА ===
  char buffer[512];
  size_t len = serializeJson(doc, buffer, sizeof(buffer));

  udpData.beginPacket(serverIP, serverDataPort);
  udpData.write((uint8_t*)buffer, len);
  udpData.endPacket();

  delay(SEND_INTERVAL_MS);
}
