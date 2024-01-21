import React from 'react';
import OtpInput from './OtpInput';


const isNumber = (s) => /[^0-9]/g.test(s);

function PhoneOtpForm() {
  const [phoneNumber, setPhoneNumber] = React.useState('');
  const [showOtpForm, setShowOtpForm] = React.useState(false);

  const handlePhoneNumberChange = (event) => {
    event.preventDefault();
    setPhoneNumber(event.target.value);
  }

  const handlePhoneSubmit = (event) => {
    event.preventDefault();
    // Phone number validation
    if(phoneNumber.length < 10 || isNumber(phoneNumber)) {
      alert("Invalid Phone Number");
      return;
    }

    // Back-end api calls
    setShowOtpForm(true);
  }

  const handleOTPSubmit = (e) => {
    e.preventDefault();
  }

  return (
    <div>
      {!showOtpForm ? 
        (<form onSubmit={handlePhoneSubmit}>
          <input type="text" value={phoneNumber} onChange={handlePhoneNumberChange}  placeholder='Enter Phone Number'/>
          <button type="submit">Submit</button>
        </form>) : 
        (<div>
          <p>Enter OTP sent to {phoneNumber}</p>
          <OtpInput length={4} onOtpSubmit={handleOTPSubmit} />
        </div>
        )
      }
    </div>
  )
}

export default PhoneOtpForm