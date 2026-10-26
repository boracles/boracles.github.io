export const messages = {
  ko: {
    pageTitle:'안개 아이 · The Lost Room 2', title:'안개 아이',
    introduction:'QR을 비추고,\n아이를 누른 채 이야기해 주세요.\n손을 떼면 소리가 음악이 됩니다.',
    start:'시작하기',loading:'준비하는 중…',
    privacy:'카메라와 마이크를 허용해 주세요.\n누르고 있는 동안의 소리만 기기 안에서 처리합니다.',
    holdLabel:'안개 아이를 누른 채 이야기하기',language:'언어',
    mute:'소리 끄기',unmute:'소리 켜기',exit:'마치기',
    endTitle:'안개 아이와의 시간을 마쳤습니다.',endNote:'카메라와 마이크를 껐고, 이번 녹음과 음악을 지웠습니다.',again:'처음으로',
    listening:'듣고 있어요',hold:'아이를 누른 채 이야기해 주세요.',
    recording:'듣고 있어요. 손을 떼면 음악이 시작돼요.',
    micReady:'마이크가 준비됐어요. 아이를 다시 누른 채 이야기해 주세요.',
    micPermission:'마이크를 허용한 뒤 아이를 다시 눌러 주세요.',
    moreVoice:'아이를 누른 채 조금 더 이야기해 주세요.',
    creating:'소리를 음악으로 만들고 있어요.',repeat:'다시 누르면 새로운 소리로 음악을 만들어요.',
    musicError:'음악을 만들지 못했어요. 아이를 누르고 다시 이야기해 주세요.',
    qrAim:'티백 뒷면의 QR을 비춰 주세요.',qrFound:'QR 위치를 찾았어요.',
    qrAgain:'티백 뒷면의 QR을 다시 비춰 주세요.',qrFull:'티백 뒷면의 QR 전체를 비춰 주세요.',
    cameraRetry:'카메라 다시 열기',cameraError:'브라우저 설정에서 카메라를 허용해 주세요.'
  },
  en: {
    pageTitle:'Fog Child · The Lost Room 2',title:'Fog Child',
    introduction:'Point at the QR.\nHold the child while you speak.\nLet go, and your voice becomes music.',
    start:'Begin',loading:'Getting ready…',
    privacy:'Allow the camera and microphone.\nSound is captured only while you hold, and stays on your device.',
    holdLabel:'Hold the Fog Child while you speak',language:'Language',
    mute:'Mute sound',unmute:'Turn sound on',exit:'Finish',
    endTitle:'Your time with the Fog Child has ended.',endNote:'The camera and microphone are off. Your recording and music have been cleared.',again:'Start again',
    listening:'Listening',hold:'Hold the child while you speak.',
    recording:'Listening. Let go to hear your music.',
    micReady:'The microphone is ready. Hold the child again while you speak.',
    micPermission:'Allow the microphone, then hold the child again.',
    moreVoice:'Hold the child and speak a little longer.',
    creating:'Turning your voice into music…',repeat:'Hold again to make music from a new story.',
    musicError:'The music could not be made. Hold the child and try again.',
    qrAim:'Point at the QR on the back of the tea wrapper.',qrFound:'QR found.',
    qrAgain:'Point at the QR on the wrapper again.',qrFull:'Keep the whole QR on the wrapper in view.',
    cameraRetry:'Try the camera again',cameraError:'Allow camera access in your browser settings.'
  },
  ja: {
    pageTitle:'霧の子 · The Lost Room 2',title:'霧の子',
    introduction:'QRコードにカメラを向けて、\n霧の子を押したまま話してください。\n指を離すと、声が音楽に変わります。',
    start:'はじめる',loading:'準備中…',
    privacy:'カメラとマイクを許可してください。\n押している間の声だけを端末内で処理します。',
    holdLabel:'霧の子を押したまま話す',language:'言語',
    mute:'音を消す',unmute:'音を出す',exit:'おわる',
    endTitle:'霧の子との時間が終わりました。',endNote:'カメラとマイクを停止し、録音と音楽を消去しました。',again:'もう一度',
    listening:'聞いています',hold:'霧の子を押したまま話してください。',
    recording:'聞いています。指を離すと音楽が流れます。',
    micReady:'マイクの準備ができました。もう一度、押したまま話してください。',
    micPermission:'マイクを許可してから、もう一度霧の子を押してください。',
    moreVoice:'押したまま、もう少し長く話してください。',
    creating:'あなたの声を音楽に変えています…',repeat:'もう一度押すと、新しい話から音楽を作れます。',
    musicError:'音楽を作れませんでした。霧の子を押して、もう一度話してください。',
    qrAim:'ティーバッグの包装の裏にあるQRコードを映してください。',qrFound:'QRコードを見つけました。',
    qrAgain:'包装のQRコードをもう一度映してください。',qrFull:'包装のQRコード全体を画面に入れてください。',
    cameraRetry:'カメラをもう一度開く',cameraError:'ブラウザの設定でカメラを許可してください。'
  }
};
export function chooseLanguage({saved,requested,languages=[]}={}) {
  if(messages[requested])return requested;
  if(messages[saved])return saved;
  for(const language of languages){const code=language.toLowerCase().split('-')[0];if(messages[code])return code;}
  return 'en';
}
