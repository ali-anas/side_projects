import React from 'react'

const OtpInput = ({ length, onOtpSubmit }) => {
  const [otpValue, setOtpValue] = React.useState(new Array(length).fill(''));
  const inputRefs = React.useRef([]);

  React.useEffect(() => {
    if(inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [])

  const handleOTPChange = (index, e) => {
    e.preventDefault();
    const val = e.target.value;
    if(isNaN(val)) return;
    const newOtp = otpValue.map((d, i) => (i === index) ? val.substring(val.length - 1) : d);
    setOtpValue(newOtp);

    // submit OTP
    // when all fields are filled
    const combinedOtpValue = newOtp.join('');
    if(combinedOtpValue.length === length) {
      onOtpSubmit(combinedOtpValue);
    }

    // move to next input field if current field is filled
    if(val && index < length - 1) {
      inputRefs.current[newOtp.indexOf('')].focus();
    }
  }

  const handleClick = (index) => {
    // move cursor from start to end of string in input field
    inputRefs.current[index].setSelectionRange(1, 1);

    // handle sparse values filled in otp fields
    //  move to not filled input field
    if(index > 0 && otpValue[index-1] === '') {
      inputRefs.current[otpValue.indexOf('')].focus();
    }
  }

  const handleKeyDown = (index, e) => {
    // moving cursor to previous input field when backspace is pressed
    if(e.key === 'Backspace' && otpValue[index] === '') {
      if(index > 0) {
        inputRefs.current[index-1].focus();
      }
    }
  }

  return (
    <div>{otpValue.map((val, index) => {
      return <input key={index} ref={(input) => inputRefs.current[index]=input} onChange={(e) => handleOTPChange(index, e)} value={otpValue[index]} type="text" onClick={() => handleClick(index)} onKeyDown={(e) => handleKeyDown(index, e)} className="otpInput" />
    })}</div>
  )
}

export default OtpInput