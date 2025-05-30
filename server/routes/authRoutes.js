import { Router } from 'express';
import axios from 'axios';
import qs from 'querystring';
import crypto from 'crypto'; 
import { loginOrSignupKakaoUser, loginOrSignupGoogleUser} from '../services/authService.js'; // 서비스 호출
import refreshTokenMiddleware from '../middleware/refreshTokenMiddleware.js';
const router = Router();

//카카오 로그인에 필요한 정보
const kakao = {
    CLIENT_ID: process.env.REST_API_KEY,
    REDIRECT_URI: process.env.REDIRECT_URI,
};

const blacklist = new Set();


// 카카오 로그인 요청 처리
router.get('/kakao', (req, res) => {
    const KAKAO_AUTH_URL = `https://kauth.kakao.com/oauth/authorize?client_id=${kakao.CLIENT_ID}&redirect_uri=${kakao.REDIRECT_URI}&response_type=code`;
    res.redirect(KAKAO_AUTH_URL);
});
  
router.get('/kakao/callback', async (req, res) => {
    try {
      const tokenResponse = await axios({
        method: 'POST',
        url: 'https://kauth.kakao.com/oauth/token',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        data: qs.stringify({
          grant_type: 'authorization_code',
          client_id: kakao.CLIENT_ID,
          redirect_uri: kakao.REDIRECT_URI,
          code: req.query.code,
        }),
      });
  
      const accessToken = tokenResponse.data.access_token;
      //console.log('Access Token:', accessToken);                //점검용1

      const userResponse = await axios({
        method: 'GET',
        url: 'https://kapi.kakao.com/v2/user/me',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
  
      const kakaoUserInfo = {
        id: userResponse.data.id.toString(),
        kakao_account: userResponse.data.kakao_account,
      };

      const { user, token } = await loginOrSignupKakaoUser(kakaoUserInfo);

      // JWT 토큰을 HttpOnly 쿠키에 저장
      res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'None',
        secure: true,
        maxAge: 3600000 // 1시간
      });

      //console.log('user Data:', user.loginId, user.nickname);           //점검용2

      // 클라이언트 리다이렉션 URL (프론트엔드 주소로 변경해야 함)
      const clientRedirectUrl = `https://currex-frontend.vercel.app/?token=${encodeURIComponent(token)}&userId=${user._id}&loginId=${encodeURIComponent(user.loginId)}&nickname=${encodeURIComponent(user.nickname)}`;

      // 클라이언트로 리다이렉션
      res.redirect(clientRedirectUrl);

    } catch (error) {
      console.error('카카오 로그인 에러:', error);
      console.error(error.message);
      console.error('Error getting Kakao token:', error.response ? error.response.data : error.message);
      res.status(500).json({ message: '카카오 로그인 처리 중 오류가 발생했습니다.',
        data: error.data,
       });
    }
  });


router.post('/kakaologout', async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.split(' ')[1];
    if (accessToken) {
      // 카카오 로그아웃 API 호출
      await axios.post('https://kapi.kakao.com/v1/user/logout', null, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      // 토큰 블랙리스트 추가 (선택적)
      blacklist.add(accessToken);
    }
    
    // 쿠키 제거
    res.clearCookie('token');
  
    res.status(200).json({ 
      success: true, 
      message: '로그아웃 처리가 완료되었습니다.' 
    });
  } catch (error) {
    console.error('카카오 로그아웃 에러:', error);
    res.status(500).json({ 
      success: false, 
      message: '로그아웃 처리 중 오류가 발생했습니다.' 
    });
  }
});
  


//구글 로그인
const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;// YOUR GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;// YOUR GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'];

//State 생성
function generateState(){
  return crypto.randomBytes(16).toString('hex');
}

//oauth url 생성 함수
function createGoogleOAuthURL() {
  const state = generateState();
  const scopes = GOOGLE_SCOPES.join(' ');
  
  const url = `${GOOGLE_OAUTH_URL}?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}`;
  
  return { url, state };
}


router.get('/google', (req, res) => {
  const { url, state } = createGoogleOAuthURL();
  console.log('Generated OAuth URL:', url);             //점검용
  req.session.oauthState = state; // 세션에 state 저장
  res.redirect(url);
});

// 구글 계정 선택 화면에서 계정 선택 후 redirect
router.get('/google/callback', async(req, res) => {
  const { state, code } = req.query;
  
  if(state !== req.session.oauthState){
    return res.status(400).send("Invalid state parameter");
  }
  try{
    // 액세스 토큰 요청
    const { data } = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const { access_token } = data;

    console.log('Access Token:', access_token);                //점검용 3

    // 사용자 정보 요청
    const userInfo = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const googleUserInfo =  {
      google_account: userInfo.data.id.toString(),
      name: userInfo.data.name,
      profile_img: userInfo.data.picture
    }

    console.log('Google User Info:', googleUserInfo);

    // 사용자 정보를 처리하고 세션을 생성하거나 JWT를 발급
    const { user, token } = await loginOrSignupGoogleUser(googleUserInfo);

    console.log('generated token', token);      //점검용 -- 지금 안됨

    // JWT 토큰을 HttpOnly 쿠키에 저장
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'None',
      secure: true,
      maxAge: 3600000 // 1시간
    });

    console.log('user Data:', user.loginId, user.nickname);           //점검용 4

    // 클라이언트로 리다이렉션
    const clientRedirectUrl = `https://currex-frontend.vercel.app/?token=${encodeURIComponent(token)}&userId=${user._id}&loginId=${encodeURIComponent(user.loginId)}&nickname=${encodeURIComponent(user.nickname)}`;
    res.redirect(clientRedirectUrl);

  }catch(error){
    console.error('Authentication failed:', error);
    res.status(500).json({error: 'Authentication failed', details: error.message});
  }
});

//구글 로그아웃

router.post('/googlelogout', async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.split(' ')[1];
    if (accessToken) {
      // 구글 로그아웃 API 호출
      await axios.post('https://accounts.google.com/o/oauth2/revoke', null, {
        params: { token: accessToken }
      });

      // 토큰 블랙리스트 추가 (선택적)
      blacklist.add(accessToken);
    }

    // 쿠키 제거
    res.clearCookie('token');

    res.status(200).json({ 
      success: true, 
      message: '구글 로그아웃 처리가 완료되었습니다.' 
    });
  } catch (error) {
    console.error('구글 로그아웃 에러:', error);
    res.status(500).json({ 
      success: false, 
      message: '구글 로그아웃 처리 중 오류가 발생했습니다.' 
    });
  }
});



//refreshToken을 통한 새 accessToken발급
router.post('/refresh', refreshTokenMiddleware);

export default router;
