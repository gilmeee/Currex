import jwt from '../utils/jwt.js';
import User from '../models/user.js';

async function refreshTokenMiddleware(req, res){
    try{
        const refreshToken = req.cookies.refreshToken || req.headers["authorization"]?.split(" ")[1];

        if(!refreshToken){
            return res.status(401).json({message: "리프레시 토큰이 없습니다."});
        }

        //리프레시 토큰 검증
        jwt.verifyToken(refreshToken);


        //DB에서 유저 조회
        const user = await User.findOne({ refreshToken });
        if(!user || user.refreshTokenExpiresAt < new Date()){
            return res.status(403).json({message: "리프레시 토큰이 만료되었습니다. 다시 로그인하세요."});
        }

        //새 액세스 토큰 발급
        const newAccessToken = jwt.generateToken({id: user.loginId, nickname: user.nickname})

        res.status(200).json({accessToken: newAccessToken});
    }catch(error){
        console.log("새로운 액세스 토큰 발급 중 에러 발생: ", error);
        res.status(500).json({message: '서버오류가 발생하였습니다.'});
    }
};

export default refreshTokenMiddleware;