# Job-Copilot Mobile (React Native / Android)

An Expo-managed native Android client for the Job-Copilot FastAPI backend. Built with React Native, TypeScript, Expo Router, and TanStack React Query.

---

## Prerequisites

1. **Node.js**: LTS version (v20+ recommended).
2. **Java Development Kit (JDK)**: JDK 17 (required by modern React Native and Gradle).
3. **Android Studio**:
   - Android SDK (API 34 or 35)
   - Android SDK Command-line Tools
   - Android SDK Build-Tools
   - Android SDK Platform-Tools
   - Android Emulator
4. **Environment Variables**:
   - `ANDROID_HOME`: Path to your Android SDK (e.g. `C:\Users\<user>\AppData\Local\Android\Sdk`)
   - `JAVA_HOME`: Path to JDK 17 (e.g. `C:\Program Files\Eclipse Adoptium\jdk-17...`)
   - Add `%ANDROID_HOME%\platform-tools` to system `PATH`.

---

## Quick Start

### 1. Configure the API URL

Copy the example environment configuration:

```powershell
cd mobile
Copy-Item .env.example .env
```

Set `EXPO_PUBLIC_API_URL` based on your target device:

- **Android Emulator**: `http://10.0.2.2:8000` (10.0.2.2 maps to the Windows host machine)
- **Physical Android Device on LAN**: `http://<your-windows-lan-ip>:8000` (e.g. `http://192.168.1.105:8000`)
- **Production Server**: `https://<deployed-domain>`

> Note: Never use `localhost` when running on an Android emulator or device, as `localhost` points to the device itself.

### 2. Install Dependencies

```powershell
cd mobile
npm install
```

### 3. Run the Development Server

```powershell
cd mobile
npx expo start
```

Press `a` in the terminal to launch the app on an active Android emulator or connected device.

---

## Android Builds

### Running Directly on Android Emulator or Device

Ensure your Android emulator is running or your physical device is connected with USB Debugging enabled (`adb devices`).

```powershell
cd mobile
npx expo run:android
```

### Building Release APK Locally

```powershell
cd mobile
npx expo prebuild
npx expo run:android --variant release
```

The compiled release APK will be generated at:
`mobile\android\app\build\outputs\apk\release\app-release.apk`

---

## Authentication Contract

The mobile app connects to the Job-Copilot FastAPI backend using an opaque session bearer token:
1. `POST /api/auth/register` and `POST /api/auth/login` issue a secure `session_token`.
2. The token is stored in **Expo SecureStore** on the device.
3. Every authenticated API request carries `Authorization: Bearer <session_token>`.
4. On app launch, `GET /api/auth/me` verifies session validity.
5. If the session expires or is revoked (401 response), the app clears the token and redirects to sign-in.
6. Signing out revokes the session on the backend and deletes the stored token from SecureStore.

---

## Key Features

- **Dashboard (Home)**: High-level metrics for verified facts, open jobs, and active applications, with dynamic next-action recommendations.
- **Profile & Facts**: Verified, proposed, and rejected candidate facts. Support for pasting raw resume text and uploading PDF resumes via Expo Document Picker.
- **Job Fit & Evidence**: Real-time fit percentage, requirement-to-fact matching, and gaps.
- **Application Pipeline**: Kanban-style progress tracking across all lifecycle states:
  - Needs Attention
  - To Prepare
  - To Review
  - Ready to Apply
  - Submitted
  - In Process
  - Closed
- **Application Documents & Approval**: Generation and review of resume bullets, summary, cover letters, and screening answers with citation IDs, optimistic locking (`lock_version`), and allowed state transitions.
- **PDF Export**: In-app download and native Android sharing for generated resumes and screening answers.
- **Inbound Inbox**: View ATS updates, interview requests, and job alert emails parsed by the backend worker. Assign or import off-system applications.
- **Job Boards**: Manage Greenhouse and Lever ingestion boards and trigger on-demand polling.
- **Themes**: System automatic, Dark, and Light mode support adhering to the Job-Copilot design system.

---

## Testing & Quality Checks

Run TypeScript typecheck:
```powershell
cd mobile
npm run typecheck
```

Run test suite:
```powershell
cd mobile
npm test
```
