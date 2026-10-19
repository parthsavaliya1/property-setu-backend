import { legalPage } from "./legalPages.js";

export const privacySections = [
  [
    "Who we are",
    "PropertySetu is a property marketplace. This policy covers the Android app (com.propertyhub.app), website and backend services."
  ],
  [
    "Information we collect",
    "We process your name, mobile number, verification codes and optional profile information (photo, bio and address). We store listings, photos, videos, documents, messages, inquiries, visits, reports, blocks and favourites. Listing views include device platform. Where enabled, payment records include amounts, references and wallet balances; we do not store card numbers or UPI PINs."
  ],
  [
    "Location and selected files",
    "With permission, foreground location helps fill addresses and find nearby homes. We do not request background location. The system picker gives us only the files you select. Published listings are visible to other users. Signed-in users may see contact information made available with a listing. Do not publish sensitive documents or information you do not want others to access."
  ],
  [
    "Voice input",
    "When you choose the microphone, the device speech-recognition service processes speech to fill the selected field. Depending on the device and provider, audio may be sent to that provider for recognition. PropertySetu does not intentionally save microphone recordings. Text you submit is stored with that field. Voice input is optional; you can type instead and revoke microphone permission in device settings."
  ],
  [
    "Reading a listing from a photo",
    "When you choose photo reading, the selected image is sent through our backend to Google's Gemini service to extract property fields. Review and correct the result before publishing. Do not submit images with sensitive documents or personal information you are not authorised to share. Selecting ordinary listing photos does not itself invoke photo reading."
  ],
  [
    "How we use information",
    "We use data to operate accounts, search and publish listings, deliver messages and notifications, process enabled listing services, prevent fraud and handle safety reports. We do not sell personal information."
  ],
  [
    "Service providers and sharing",
    "Hosting and database providers process service records. Bunny.net stores uploads; 2Factor delivers phone verification; Google Gemini processes optional image extraction. The device speech provider processes optional voice input. Firebase Remote Config receives the app/project identifier, a shared configuration-instance label and network metadata to supply app configuration. Expo and platform notification services process push tokens and notification payloads. Razorpay processes payments where enabled. Other users see published listings and information shared in conversations. We may disclose information when required by law."
  ],
  [
    "Retention and deletion",
    "We retain account information while you use the service. Delete your account in About us or on our public Delete account page. Deletion removes the active account, profile, owned listings, conversations involving your account, inquiries, visits and linked account data. Uploaded files are placed in a persistent deletion queue. Storage cleanup must be operated regularly. Legacy uploads without ownership records need operator verification before removal; backups and provider caches may keep copies until they expire or are cleared. Contact support for deletion assistance, including if you cannot access your account. Anonymised payment references and purchase-token fingerprints may remain for accounting and duplicate-purchase prevention. Pending payment tokens are removed after finalisation. Copies independently saved by other users cannot be removed by PropertySetu."
  ],
  [
    "Your choices",
    "You may browse without an account, choose what to upload, and decline location, notification and microphone access. Manage blocks in About us. Account deletion is also available in a browser without installing the app. Contact support about access, correction or deletion."
  ],
  [
    "Children and changes",
    "PropertySetu is not intended for children under 13. Contact support if a child has provided personal data. We update the policy date when this policy changes."
  ]
] as const;

export function privacyHtml() {
  return legalPage("Privacy Policy", privacySections.map(([title, body]) => `<section><h2>${title}</h2><p>${body}</p></section>`).join(""));
}
